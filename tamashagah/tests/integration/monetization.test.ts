import { describe, expect, it } from 'vitest';
import { db } from '@/lib/db';
import {
  saveApplicationDraftAction,
  submitApplicationAction,
  withdrawApplicationAction,
} from '@/features/monetization/actions';
import { computeEligibility } from '@/features/monetization/eligibility';
import { getMonetizationHistory, getMonetizationStats, listApplications, parseSnapshot } from '@/features/monetization/queries';
import { saveDraft, submitApplication, withdrawApplication } from '@/features/monetization/service';
import { createUser, createVideo } from '../helpers/factories';
import { loginAs, logout } from '../helpers/auth';
import { addFollowEvent, addViews } from '../helpers/insights-fixtures';

const DAY = 86_400_000;
const FORM = { contactEmail: 'Creator@Example.test ', acceptTerms: true };

/** 1 000 followers, 5 public videos and exactly 500 hours of REAL watch time 10 days ago. */
async function eligibleChannel(opts: { verified?: boolean } = {}) {
  const owner = await createUser({ withChannel: true, verified: opts.verified });
  const channelId = owner.channel!.id;
  await db.channel.update({ where: { id: channelId }, data: { followerCount: 1_000 } });
  const videos = await Promise.all(Array.from({ length: 5 }, () => createVideo(channelId)));
  const at = new Date(Date.now() - 10 * DAY);
  await addViews([
    { channelId, videoId: videos[0]!.id, at, watch: 900_000 },
    { channelId, videoId: videos[1]!.id, at, watch: 900_000 },
  ]);
  return { owner, channelId, videos };
}

const rowsOf = (channelId: string) => db.monetizationApplication.findMany({ where: { channelId }, orderBy: { createdAt: 'asc' } });

describe('monetization stats (real data only)', () => {
  it('counts followers, public videos, REAL watch hours of the last 365 days and all-time REAL views', async () => {
    const { channelId, videos } = await eligibleChannel();
    const stats = await getMonetizationStats(channelId);
    expect(stats).toMatchObject({ followers: 1_000, publicVideos: 5, watchHours: 500, totalViews: 2, sampleWatchHours: 0, sampleViewEvents: 0, channelSuspended: false });
    expect(computeEligibility({ followers: stats.followers, watchHours: stats.watchHours, publicVideos: stats.publicVideos }).eligible).toBe(true);

    // events outside the window or from other channels do not count
    const other = await createUser({ withChannel: true });
    const otherVideo = await createVideo(other.channel!.id);
    await addViews([
      { channelId, videoId: videos[2]!.id, at: new Date(Date.now() - 366 * DAY), watch: 3_600_000 }, // older than 365 days
      { channelId: other.channel!.id, videoId: otherVideo.id, at: new Date(Date.now() - DAY), watch: 3_600_000 },
    ]);
    const after = await getMonetizationStats(channelId);
    expect(after.watchHours).toBe(500);
    expect(after.totalViews).toBe(3); // all-time REAL views include the old one
  });

  it('IGNORES synthetic (SEED) events and reports them separately', async () => {
    const owner = await createUser({ withChannel: true });
    const channelId = owner.channel!.id;
    const video = await createVideo(channelId);
    await addViews([
      { channelId, videoId: video.id, at: new Date(Date.now() - 5 * DAY), watch: 3_600_000, source: 'SEED' },
      { channelId, videoId: video.id, at: new Date(Date.now() - 5 * DAY), watch: 7_200, source: 'REAL' },
    ]);
    const stats = await getMonetizationStats(channelId);
    expect(stats).toMatchObject({ watchHours: 2, totalViews: 1, sampleWatchHours: 1_000, sampleViewEvents: 1 });
  });

  it('counts only listed-public videos and drops everything for a suspended channel', async () => {
    const owner = await createUser({ withChannel: true });
    const channelId = owner.channel!.id;
    for (const state of ['public', 'public', 'unlisted', 'private', 'draft', 'processing', 'failed', 'scheduled', 'takedown'] as const) {
      await createVideo(channelId, { state });
    }
    expect((await getMonetizationStats(channelId)).publicVideos).toBe(2);
    await db.channel.update({ where: { id: channelId }, data: { suspendedAt: new Date() } });
    expect(await getMonetizationStats(channelId)).toMatchObject({ publicVideos: 0, channelSuspended: true });
  });

  it('is exact at the watch-hour boundary', async () => {
    const owner = await createUser({ withChannel: true });
    const channelId = owner.channel!.id;
    const video = await createVideo(channelId);
    await addViews([{ channelId, videoId: video.id, at: new Date(Date.now() - DAY), watch: 1_799_999 }]);
    const stats = await getMonetizationStats(channelId);
    expect(stats.watchHours).toBeLessThan(500);
    expect(computeEligibility({ followers: 1_000, watchHours: stats.watchHours, publicVideos: 5 }).eligible).toBe(false);
  });
});

describe('application flow (creator side)', () => {
  it('requires a signed-in channel owner with a verified e-mail', async () => {
    const plain = await createUser();
    const unverified = await createUser({ withChannel: true, verified: false });
    logout();
    expect(await saveApplicationDraftAction(FORM)).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    expect(await submitApplicationAction(FORM)).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    expect(await withdrawApplicationAction()).toMatchObject({ ok: false, code: 'UNAUTHENTICATED' });
    await loginAs(plain.id);
    expect(await submitApplicationAction(FORM)).toMatchObject({ ok: false, code: 'FORBIDDEN' });
    await loginAs(unverified.id);
    expect(await saveApplicationDraftAction(FORM)).toMatchObject({ ok: false, code: 'EMAIL_NOT_VERIFIED' });
    expect(await db.monetizationApplication.count()).toBe(0);
  });

  it('saves a draft (normalized e-mail, terms time) and edits the SAME row afterwards', async () => {
    const { owner, channelId } = await eligibleChannel();
    await loginAs(owner.id);
    expect((await saveApplicationDraftAction(FORM)).ok).toBe(true);
    const [draft] = await rowsOf(channelId);
    expect(draft).toMatchObject({ status: 'DRAFT', contactEmail: 'creator@example.test', submittedAt: null, statsSnapshot: null });
    expect(draft!.acceptedTermsAt).toBeInstanceOf(Date);

    expect((await saveApplicationDraftAction({ contactEmail: 'other@example.test', acceptTerms: false })).ok).toBe(true);
    const rows = await rowsOf(channelId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: draft!.id, contactEmail: 'other@example.test', acceptedTermsAt: null });
  });

  it('validates the input strictly (e-mail, terms) and refuses unknown or forged fields', async () => {
    const { owner, channelId } = await eligibleChannel();
    await loginAs(owner.id);
    expect(await submitApplicationAction({ contactEmail: 'not-an-email', acceptTerms: true })).toMatchObject({ ok: false, code: 'VALIDATION' });
    const noTerms = await submitApplicationAction({ contactEmail: 'a@example.test', acceptTerms: false });
    expect(noTerms).toMatchObject({ ok: false, code: 'VALIDATION' });
    expect(noTerms.ok === false && noTerms.fieldErrors?.acceptTerms?.[0]).toBeTruthy();
    // a creator cannot choose a status, id or channel: the schema is strict
    for (const forged of [{ status: 'APPROVED' }, { id: 'x' }, { channelId: 'y' }, { reviewedById: owner.id }, { decisionNote: 'ok' }]) {
      expect(await submitApplicationAction({ ...FORM, ...forged })).toMatchObject({ ok: false, code: 'VALIDATION' });
      expect(await saveApplicationDraftAction({ ...FORM, ...forged })).toMatchObject({ ok: false, code: 'VALIDATION' });
    }
    expect(await rowsOf(channelId)).toHaveLength(0);
  });

  it('refuses to submit before the channel is eligible and keeps the draft', async () => {
    const owner = await createUser({ withChannel: true });
    const channelId = owner.channel!.id;
    await loginAs(owner.id);
    await saveApplicationDraftAction(FORM);
    const result = await submitApplicationAction(FORM);
    expect(result).toMatchObject({ ok: false, code: 'CONFLICT' });
    const rows = await rowsOf(channelId);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('DRAFT');
  });

  it('submits an eligible channel and stores the exact figures it decided on', async () => {
    const { owner, channelId } = await eligibleChannel();
    await loginAs(owner.id);
    const before = Date.now();
    expect((await submitApplicationAction(FORM)).ok).toBe(true);
    const [row] = await rowsOf(channelId);
    expect(row).toMatchObject({ status: 'SUBMITTED', contactEmail: 'creator@example.test', reviewedAt: null, reviewedById: null, decisionNote: null });
    expect(row!.submittedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(row!.acceptedTermsAt).toBeInstanceOf(Date);
    const snapshot = parseSnapshot(row!.statsSnapshot)!;
    expect(snapshot).toMatchObject({ followers: 1_000, totalViews: 2, watchHours: 500, videoCount: 5 });
    expect(Date.parse(snapshot.capturedAt)).toBeGreaterThanOrEqual(before - 1000);
    // the creator sees it in their list, newest first
    expect((await listApplications(channelId)).map((a) => a.status)).toEqual(['SUBMITTED']);
  });

  it('enforces ONE active application per channel (server side)', async () => {
    const { owner, channelId } = await eligibleChannel();
    await loginAs(owner.id);
    expect((await submitApplicationAction(FORM)).ok).toBe(true);
    expect(await submitApplicationAction(FORM)).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(await saveApplicationDraftAction(FORM)).toMatchObject({ ok: false, code: 'CONFLICT' });
    expect(await rowsOf(channelId)).toHaveLength(1);

    for (const status of ['UNDER_REVIEW', 'APPROVED', 'SUSPENDED'] as const) {
      await db.monetizationApplication.updateMany({ where: { channelId }, data: { status } });
      expect(await submitApplicationAction(FORM), status).toMatchObject({ ok: false, code: 'CONFLICT' });
      expect(await saveApplicationDraftAction(FORM), status).toMatchObject({ ok: false, code: 'CONFLICT' });
    }
    expect(await rowsOf(channelId)).toHaveLength(1);
  });

  it('survives a stampede: concurrent submissions and drafts still leave exactly one active row', async () => {
    const { owner, channelId } = await eligibleChannel();
    await loginAs(owner.id);
    const submits = await Promise.all(Array.from({ length: 6 }, () => submitApplicationAction(FORM)));
    expect(submits.filter((r) => r.ok)).toHaveLength(1);
    expect(submits.filter((r) => !r.ok).every((r) => !r.ok && r.code === 'CONFLICT')).toBe(true);
    expect(await rowsOf(channelId)).toHaveLength(1);

    const other = await createUser({ withChannel: true });
    await loginAs(other.id);
    const drafts = await Promise.all(Array.from({ length: 6 }, () => saveApplicationDraftAction(FORM)));
    expect(drafts.every((r) => r.ok)).toBe(true);
    expect(await rowsOf(other.channel!.id)).toHaveLength(1);
  });

  it('lets the creator withdraw only a submitted application, which becomes an editable draft again', async () => {
    const { owner, channelId } = await eligibleChannel();
    await loginAs(owner.id);
    expect(await withdrawApplicationAction()).toMatchObject({ ok: false, code: 'CONFLICT' }); // nothing to withdraw
    await submitApplicationAction(FORM);
    expect((await withdrawApplicationAction()).ok).toBe(true);
    const [row] = await rowsOf(channelId);
    expect(row).toMatchObject({ status: 'DRAFT', submittedAt: null, statsSnapshot: null, contactEmail: 'creator@example.test' });

    // …and it can be sent again: same row, no duplicate
    expect((await submitApplicationAction(FORM)).ok).toBe(true);
    const rows = await rowsOf(channelId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: row!.id, status: 'SUBMITTED' });

    for (const status of ['UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SUSPENDED'] as const) {
      await db.monetizationApplication.updateMany({ where: { channelId }, data: { status } });
      expect(await withdrawApplicationAction(), status).toMatchObject({ ok: false, code: 'CONFLICT' });
      expect((await rowsOf(channelId))[0]!.status).toBe(status); // untouched
    }
  });

  it('allows a NEW application after a rejection and keeps the decision in the history', async () => {
    const { owner, channelId } = await eligibleChannel();
    const reviewer = await createUser({ role: 'ADMIN' });
    await loginAs(owner.id);
    await submitApplicationAction(FORM);
    await db.monetizationApplication.updateMany({
      where: { channelId },
      data: { status: 'REJECTED', reviewedAt: new Date(), reviewedById: reviewer.id, decisionNote: 'ویدیوها هنوز با قوانین سازگار نیست.' },
    });
    expect((await submitApplicationAction(FORM)).ok).toBe(true);
    const rows = await rowsOf(channelId);
    expect(rows.map((r) => r.status)).toEqual(['REJECTED', 'SUBMITTED']);
    const history = await listApplications(channelId);
    expect(history.map((a) => a.status)).toEqual(['SUBMITTED', 'REJECTED']); // newest first
    expect(history[1]).toMatchObject({ decisionNote: 'ویدیوها هنوز با قوانین سازگار نیست.' });
  });

  it('can never produce an approval: whatever the creator does, the status stays DRAFT or SUBMITTED', async () => {
    const { owner, channelId } = await eligibleChannel();
    await loginAs(owner.id);
    const seen = new Set<string>();
    const snap = async () => (await rowsOf(channelId)).forEach((r) => seen.add(r.status));
    await saveApplicationDraftAction(FORM);
    await snap();
    await submitApplicationAction(FORM);
    await snap();
    await withdrawApplicationAction();
    await snap();
    await submitApplicationAction({ ...FORM, status: 'APPROVED' });
    await submitApplicationAction(FORM);
    await snap();
    expect([...seen].sort()).toEqual(['DRAFT', 'SUBMITTED']);
    const final = (await rowsOf(channelId))[0]!;
    expect(final).toMatchObject({ reviewedAt: null, reviewedById: null, decisionNote: null });
  });

  it('never touches another channel\'s application', async () => {
    const a = await eligibleChannel();
    const b = await eligibleChannel();
    await loginAs(b.owner.id);
    await submitApplicationAction(FORM);
    const bBefore = await rowsOf(b.channelId);

    await loginAs(a.owner.id);
    await submitApplicationAction(FORM);
    await withdrawApplicationAction();
    expect(await rowsOf(b.channelId)).toEqual(bBefore);
    expect((await rowsOf(a.channelId))[0]!.status).toBe('DRAFT');
  });

  it('blocks a suspended channel from applying', async () => {
    const { owner, channelId } = await eligibleChannel();
    await db.channel.update({ where: { id: channelId }, data: { suspendedAt: new Date() } });
    await loginAs(owner.id);
    // (a suspended channel also has 0 public videos, so it is ineligible either way; the explicit block wins first)
    expect(await submitApplicationAction(FORM)).toMatchObject({ ok: false, code: 'BLOCKED' });
    expect(await rowsOf(channelId)).toHaveLength(0);
  });

  it('can be driven through the service directly with a fixed clock', async () => {
    const { channelId } = await eligibleChannel();
    const now = new Date(Date.now() + 5 * DAY);
    const draft = await saveDraft({ channelId, contactEmail: 'x@example.test', acceptTerms: true }, now);
    expect(draft.acceptedTermsAt!.getTime()).toBe(now.getTime());
    const submitted = await submitApplication({ channelId, contactEmail: 'y@example.test', acceptTerms: true }, now);
    expect(submitted).toMatchObject({ id: draft.id, status: 'SUBMITTED' });
    expect(parseSnapshot(submitted.statsSnapshot)!.capturedAt).toBe(now.toISOString());
    await withdrawApplication(channelId);
    expect((await rowsOf(channelId))[0]!.status).toBe('DRAFT');
  });

  it('rate-limits write actions per user', async () => {
    const owner = await createUser({ withChannel: true });
    await loginAs(owner.id);
    const results = [];
    for (let i = 0; i < 31; i++) results.push(await saveApplicationDraftAction(FORM));
    expect(results.slice(0, 30).every((r) => r.ok)).toBe(true);
    expect(results[30]).toMatchObject({ ok: false, code: 'RATE_LIMITED' });
  });
});

describe('monthly history (Jalali months, REAL data)', () => {
  // 2026-10-11 12:30 Tehran = 19 Mehr 1405
  const NOW = new Date('2026-10-11T09:00:00.000Z');

  it('returns 12 months, buckets REAL views/hours/net followers per Jalali month and excludes SEED rows', async () => {
    const owner = await createUser({ withChannel: true });
    const channelId = owner.channel!.id;
    const video = await createVideo(channelId);
    await addViews([
      { channelId, videoId: video.id, at: '2026-09-22T20:29:59.999Z', watch: 3_600 }, // 22 Shahrivar, last instant
      { channelId, videoId: video.id, at: '2026-09-22T20:30:00.000Z', watch: 7_200 }, // 1 Mehr 00:00 sharp
      { channelId, videoId: video.id, at: '2026-10-01T10:00:00.000Z', watch: 1_800 }, // Mehr
      { channelId, videoId: video.id, at: '2026-10-02T10:00:00.000Z', watch: 99_999, source: 'SEED' }, // never counted
      { channelId, videoId: video.id, at: '2025-10-22T10:00:00.000Z', watch: 3_600 }, // 30 Mehr 1404 — before the 12-month window
    ]);
    await addFollowEvent(channelId, 'FOLLOW', '2026-09-30T10:00:00.000Z'); // Mehr
    await addFollowEvent(channelId, 'FOLLOW', '2026-10-03T10:00:00.000Z');
    await addFollowEvent(channelId, 'UNFOLLOW', '2026-10-04T10:00:00.000Z');
    await addFollowEvent(channelId, 'FOLLOW', '2026-10-05T10:00:00.000Z', 'SEED'); // never counted
    await addFollowEvent(channelId, 'FOLLOW', '2026-08-25T10:00:00.000Z'); // Shahrivar

    const history = await getMonetizationHistory(channelId, NOW);
    expect(history.months).toHaveLength(12);
    expect(history.months[0]).toMatchObject({ key: '1404-08', fromKey: '2025-10-23' }); // Aban 1404
    const byKey = Object.fromEntries(history.months.map((m) => [m.key, m]));
    expect(byKey['1405-06']).toMatchObject({ views: 1, netFollowers: 1, partial: false });
    expect(byKey['1405-06']!.watchHours).toBeCloseTo(1, 10);
    expect(byKey['1405-07']).toMatchObject({ views: 2, netFollowers: 1, partial: true, toKey: '2026-10-11' });
    expect(byKey['1405-07']!.watchHours).toBeCloseTo(2.5, 10);
    expect(history.months.filter((m) => m.views > 0).map((m) => m.key)).toEqual(['1405-06', '1405-07']);
    expect(history.sampleEvents).toBe(2); // one SEED view, one SEED follow
  });

  it('returns zeros for a channel without events (never invented data)', async () => {
    const owner = await createUser({ withChannel: true });
    const history = await getMonetizationHistory(owner.channel!.id, NOW);
    expect(history.months).toHaveLength(12);
    expect(history.months.every((m) => m.views === 0 && m.watchHours === 0 && m.netFollowers === 0)).toBe(true);
    expect(history.sampleEvents).toBe(0);
  });
});

describe('snapshot reader', () => {
  it('rejects malformed JSON instead of guessing', () => {
    expect(parseSnapshot(null)).toBeNull();
    expect(parseSnapshot('x')).toBeNull();
    expect(parseSnapshot({ followers: 1 })).toBeNull();
    expect(parseSnapshot({ followers: '1', totalViews: 1, watchHours: 1, videoCount: 1 })).toBeNull();
    expect(parseSnapshot({ followers: 1, totalViews: 2, watchHours: 3.5, videoCount: 4, capturedAt: '2026-01-01T00:00:00.000Z' })).toEqual({
      followers: 1,
      totalViews: 2,
      watchHours: 3.5,
      videoCount: 4,
      capturedAt: '2026-01-01T00:00:00.000Z',
    });
  });
});
