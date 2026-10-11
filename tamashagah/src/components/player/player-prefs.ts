/**
 * Per-viewer player conveniences kept in `localStorage`: volume / mute, chosen quality, captions language and the
 * resume positions of anonymous viewers. Everything is best effort — storage can be missing, full, blocked or
 * corrupted (private windows, thumbnails, cleared site data), so every access is wrapped and validated and the
 * player behaves correctly without any of it.
 */
export type PlayerPrefs = {
  /** 0..1 */
  volume: number;
  muted: boolean;
  /** 'auto' or a rendition height (e.g. 720) */
  quality: 'auto' | number;
  /** BCP-47 language of the chosen subtitle track, or 'off' */
  captions: string;
};

const PREFS_KEY = 'tg:player:prefs:v1';
const POSITIONS_KEY = 'tg:player:positions:v1';
const MAX_POSITIONS = 200;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Validate a stored prefs blob; unknown or out-of-range fields are dropped instead of failing. */
export function parsePrefs(raw: string | null | undefined): Partial<PlayerPrefs> {
  if (!raw) return {};
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return {};
  }
  if (!isObject(data)) return {};
  const out: Partial<PlayerPrefs> = {};
  if (typeof data.volume === 'number' && Number.isFinite(data.volume)) out.volume = Math.min(1, Math.max(0, data.volume));
  if (typeof data.muted === 'boolean') out.muted = data.muted;
  if (data.quality === 'auto') out.quality = 'auto';
  else if (typeof data.quality === 'number' && Number.isInteger(data.quality) && data.quality >= 100 && data.quality <= 8640) out.quality = data.quality;
  if (typeof data.captions === 'string' && /^(off|[A-Za-z]{2,3}(-[A-Za-z0-9]{2,8})*)$/.test(data.captions)) out.captions = data.captions;
  return out;
}

export type StoredPositions = Record<string, [position: number, savedAt: number]>;

export function parsePositions(raw: string | null | undefined): StoredPositions {
  if (!raw) return {};
  try {
    const data: unknown = JSON.parse(raw);
    if (!isObject(data)) return {};
    const out: StoredPositions = {};
    for (const [id, value] of Object.entries(data)) {
      if (!/^[0-9A-Za-z]{11}$/.test(id) || !Array.isArray(value)) continue;
      const [position, savedAt] = value;
      if (typeof position === 'number' && typeof savedAt === 'number' && Number.isFinite(position) && Number.isFinite(savedAt) && position >= 0) {
        out[id] = [position, savedAt];
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** Insert/update one position and keep only the `max` most recently saved ones. */
export function upsertPosition(map: StoredPositions, videoId: string, position: number, now: number, max = MAX_POSITIONS): StoredPositions {
  const next: StoredPositions = { ...map, [videoId]: [Math.round(position * 100) / 100, now] };
  const entries = Object.entries(next);
  if (entries.length <= max) return next;
  return Object.fromEntries(entries.sort((a, b) => b[1][1] - a[1][1]).slice(0, max));
}

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    return null; // access itself can throw (blocked cookies / sandboxed iframes)
  }
}

export function readPrefs(): Partial<PlayerPrefs> {
  try {
    return parsePrefs(storage()?.getItem(PREFS_KEY));
  } catch {
    return {};
  }
}

export function writePrefs(patch: Partial<PlayerPrefs>): void {
  try {
    const s = storage();
    if (!s) return;
    s.setItem(PREFS_KEY, JSON.stringify({ ...parsePrefs(s.getItem(PREFS_KEY)), ...patch }));
  } catch {
    /* quota exceeded / blocked: preferences simply are not remembered */
  }
}

export function readLocalPosition(videoId: string): { position: number; at: number } | null {
  try {
    const entry = parsePositions(storage()?.getItem(POSITIONS_KEY))[videoId];
    return entry ? { position: entry[0], at: entry[1] } : null;
  } catch {
    return null;
  }
}

export function writeLocalPosition(videoId: string, position: number, now = Date.now()): void {
  try {
    const s = storage();
    if (!s || !Number.isFinite(position) || position < 0) return;
    s.setItem(POSITIONS_KEY, JSON.stringify(upsertPosition(parsePositions(s.getItem(POSITIONS_KEY)), videoId, position, now)));
  } catch {
    /* ignore */
  }
}
