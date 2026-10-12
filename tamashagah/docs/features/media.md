# Media: uploads, storage, transcoding, delivery and the creator studio

Owned by the media area: `src/features/{uploads,transcoding,videos-studio}`, `worker/**`, `src/app/api/{upload,studio/videos}`,
`src/app/media`, `src/app/studio/{upload,videos}` and `src/components/studio`. Everything below is implemented and tested.

## Data flow

```
browser (tus-js-client, 8 MiB chunks)          POST/HEAD/PATCH/DELETE /api/upload[/<videoId>]   (tus 1.0, @tus/server)
   │  onUploadCreate: auth + quota + Video(AWAITING_UPLOAD)        stores bytes at  uploads/<videoId>  (fs or S3 multipart)
   ▼
onUploadFinish → completeUpload(): QUEUED + MediaAsset(SOURCE) + TranscodeJob + BullMQ job  (idempotent; also called by the
   client's confirmUploadAction and healed by the `video.requeue-orphans` job)
   ▼
worker (BullMQ): ffprobe → ONE ffmpeg run (1080/720/480/360p, H.264 High + AAC, MPEG-TS HLS) → 3 poster candidates →
   master.m3u8 → finalize (row lock): READY + publish decision (PUBLISHED / SCHEDULED / DRAFT) + notifications
   ▼
GET /media/videos/<id>/hls/master.m3u8 … (visibility checked per request, Range + ETag, immutable segments)
```

Stages and progress windows: PROBE 0–4 %, TRANSCODE 4–86 %, THUMBNAILS 86–90 %, PACKAGE 90–98 %, FINALIZE 98–100 %.

## Decisions worth knowing

* **Ladder by the SHORT side, never upscaled.** A 360p source gets exactly one 360p rendition; below 360 p one rung at source size.
  Keyframes are forced at segment multiples (`force_key_frames`, CFR via `fps`) so every rendition cuts at the same times.
  Rotation, SAR, interlacing and colour tags are normalised; HDR is tone-mapped only when this ffmpeg build has zscale/tonemap.
* **Kind** (`VIDEO` / `SHORT`): vertical or square and < 90 s → SHORT, unless the creator chose. The choice lives in
  `MediaAsset(SOURCE).meta.kindChoice` (no schema change).
* **Failures**: deterministic ones (corrupt, no video stream, too long, unsupported container) fail at once with a safe Persian
  `failureReason`; transient ones retry with back-off (3 attempts). Retry from the studio re-queues from the kept source.
  A video deleted while processing is detected (progress reporter / `FOR UPDATE` in finalize) and its files are swept.
* **tus security**: every request is authorised in `onIncomingRequest` (verified user + channel, owner only — not even
  moderators); other people's and unknown ids are the same 404. Quotas (per-file size, uploads/day, bytes/day) are checked
  in `onUploadCreate` under a per-channel advisory lock, so parallel uploads cannot overshoot. Lock timeouts answer 423
  (tus clients retry on 423, but start a new upload on other failures).
* **Locker**: Redis lease (`SET NX PX` + heartbeat + cooperative release), safe across several app instances.
* **Delivery**: `MEDIA_DELIVERY=proxy` streams from storage. `redirect` (S3 only) streams playlists but answers segments with a
  302 to a 300 s presigned URL after the same visibility check. The bucket then needs a CORS rule for the site origin.
* **Publishing**: `publishOnReady` / `scheduledFor` are recorded while a video is still processing; the worker applies them under
  the same row lock the studio uses. `video.publish-scheduled` runs every minute. Followers are notified once per video.
* **File uploads in the studio** (custom poster, subtitles) are Route Handlers, not Server Actions: Server Actions are capped at 2 MB.
  Posters are re-encoded by `lib/images`; SRT is converted to WebVTT (Windows-1256 fallback, ≤ 1 MiB, ≤ 10 languages).

## Endpoints

| Route | Purpose |
| --- | --- |
| `/api/upload`, `/api/upload/<id>` | tus (create, HEAD offset, PATCH, DELETE = cancel) |
| `GET /api/studio/videos/<id>/status`, `GET /api/studio/videos/status?ids=a,b` | processing state (polled; batch for lists) |
| `POST /api/studio/videos/<id>/thumbnail`, `…/subtitles` | multipart uploads (≤ 8 MB / ≤ 1 MiB) |
| `/media/<key>` | HLS, posters, thumbnails, subtitles, avatars; never `uploads/…` |
| Server Actions | update, delete, retry, bulk (publish / visibility / delete ≤ 50), confirm upload, select thumbnail, delete subtitle |

## Limits and formats

Allowed extensions: MP4 M4V MOV MKV WEBM AVI WMV FLV MPG MPEG 3GP OGV (the real gate is ffprobe + a container allow-list).
`UPLOAD_MAX_BYTES` (2 GiB), `UPLOAD_MAX_PER_DAY` (50), `UPLOAD_DAILY_QUOTA_BYTES` (10 GiB), `UPLOAD_STALE_HOURS` (48, then the
unfinished upload is purged). Source limits: ≥ 16 px, ≤ 8192 px long side, ≤ 4 h. Other env: `STORAGE_DRIVER=fs|s3`, `S3_*`,
`MEDIA_DELIVERY`, `FFMPEG_PATH`, `FFPROBE_PATH`, `WORKER_CONCURRENCY`, `TRANSCODE_PRESET`, `WORKER_TMP_DIR`.

## Operations

* Run the worker next to the app (`pnpm dev:worker`, or the built `dist/worker/index.js`); it needs Redis and ffmpeg/ffprobe.
* Maintenance schedules (BullMQ job schedulers, Asia/Tehran): publish-scheduled every 60 s, requeue-orphans every 5 min,
  stale uploads hourly, expired auth rows 03:15, **counter reconcile 03:30** (rewrites like / comment / view counters from the
  source tables).
* S3: add a lifecycle rule that aborts incomplete multipart uploads after 2 days; the worker also aborts those of purged uploads.
* `pnpm seed:media` creates demo videos for the demo creators through the real upload service and pipeline (runs the pipeline
  in-process when no worker is attached). Counters stay at zero; only `createdAt` is spread over past weeks.

## Tests

Unit: planner, ffmpeg args, probe, progress, playlist, kind, SRT→VTT, publish rules, upload policy, browser upload engine.
Integration (real ffmpeg on 2–4 s generated clips, real Postgres/Redis): pipeline, defaults, source retention, tus hooks, quotas,
ownership, locker, maintenance jobs, studio actions / queries / media endpoints, delivery rules; S3 tests run against an emulator
(`S3_TEST_ENDPOINT`, e.g. `moto_server -p 5555`) and skip when none is reachable. E2E: `tests/e2e/media.spec.ts`.

## Known limitations

* HDR → SDR tone-mapping is unit-tested only (no HDR sample is generated).
* One video format ladder (no audio-only renditions, no DASH, no DRM); a source that is already progressive is still re-encoded.
* A browser cannot keep file handles across visits, so continuing an unfinished upload means picking the same file again.
