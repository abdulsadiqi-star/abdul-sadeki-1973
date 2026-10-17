import { describe, expect, it } from 'vitest';
import { monetizationRequirements } from '@/config/site';
import { ceilTo, computeEligibility, floorTo } from '@/features/monetization/eligibility';
import { ACTIVE_STATUSES, applicationActions, isActiveStatus } from '@/features/monetization/rules';
import { NullBillingProvider, getBillingProvider } from '@/features/monetization/billing';

const REQ = { minFollowers: 1_000, minWatchHours: 500, minPublicVideos: 5, windowDays: 365 };

describe('eligibility math', () => {
  it('uses the configured thresholds (followers, watch hours in the last 365 days, public videos)', () => {
    expect(monetizationRequirements).toEqual(REQ);
  });

  it('is eligible only when every requirement is met', () => {
    const ok = computeEligibility({ followers: 1_000, watchHours: 500, publicVideos: 5 });
    expect(ok.eligible).toBe(true);
    expect(ok.missing).toEqual([]);
    expect(ok.items.every((i) => i.met && i.progress === 1 && i.remaining === 0)).toBe(true);

    for (const input of [
      { followers: 999, watchHours: 500, publicVideos: 5 },
      { followers: 1_000, watchHours: 499.99, publicVideos: 5 },
      { followers: 1_000, watchHours: 500, publicVideos: 4 },
    ]) {
      const result = computeEligibility(input);
      expect(result.eligible).toBe(false);
      expect(result.missing).toHaveLength(1);
    }
  });

  it('reports progress and what is missing per requirement', () => {
    const result = computeEligibility({ followers: 250, watchHours: 125.5, publicVideos: 2 });
    const byKey = Object.fromEntries(result.items.map((i) => [i.key, i]));
    expect(byKey.followers).toMatchObject({ current: 250, required: 1_000, met: false, progress: 0.25, remaining: 750 });
    expect(byKey.watchHours).toMatchObject({ current: 125.5, required: 500, met: false, progress: 0.251, remaining: 374.5 });
    expect(byKey.publicVideos).toMatchObject({ current: 2, required: 5, met: false, progress: 0.4, remaining: 3 });
    expect(result.missing.map((m) => m.key)).toEqual(['followers', 'watchHours', 'publicVideos']);
  });

  it('caps progress at 100 % and never reports negative remaining', () => {
    const result = computeEligibility({ followers: 50_000, watchHours: 9_999, publicVideos: 80 });
    expect(result.items.map((i) => [i.progress, i.remaining])).toEqual([[1, 0], [1, 0], [1, 0]]);
  });

  it('treats a brand-new channel (zeros) and bad numbers as 0 progress, not NaN', () => {
    const zero = computeEligibility({ followers: 0, watchHours: 0, publicVideos: 0 });
    expect(zero.eligible).toBe(false);
    expect(zero.items.map((i) => i.progress)).toEqual([0, 0, 0]);
    const bad = computeEligibility({ followers: Number.NaN, watchHours: -5, publicVideos: Number.POSITIVE_INFINITY });
    expect(bad.items[0]).toMatchObject({ current: 0, met: false });
    expect(bad.items[1]).toMatchObject({ current: 0, met: false });
    expect(Number.isFinite(bad.items[2]!.current)).toBe(true);
  });

  it('is exact at the boundary: 499.96 hours is not 500', () => {
    const r = computeEligibility({ followers: 1_000, watchHours: 499.96, publicVideos: 5 });
    expect(r.eligible).toBe(false);
    expect(r.items[1]).toMatchObject({ met: false });
    expect(r.items[1]!.remaining).toBeCloseTo(0.04, 10);
  });

  it('accepts custom thresholds', () => {
    expect(computeEligibility({ followers: 10, watchHours: 1, publicVideos: 1 }, { minFollowers: 10, minWatchHours: 1, minPublicVideos: 1, windowDays: 30 }).eligible).toBe(true);
  });

  it('rounds for display without lying: floor for what is reached, ceil for what is missing', () => {
    expect(floorTo(499.96, 1)).toBe(499.9);
    expect(floorTo(500, 1)).toBe(500);
    expect(floorTo(12.3456, 2)).toBe(12.34);
    expect(ceilTo(0.04, 1)).toBe(0.1);
    expect(ceilTo(374.5, 1)).toBe(374.5);
    expect(ceilTo(3, 1)).toBe(3);
  });
});

describe('application rules', () => {
  it('counts exactly DRAFT, SUBMITTED, UNDER_REVIEW, APPROVED and SUSPENDED as active', () => {
    expect([...ACTIVE_STATUSES].sort()).toEqual(['APPROVED', 'DRAFT', 'SUBMITTED', 'SUSPENDED', 'UNDER_REVIEW']);
    expect(isActiveStatus('REJECTED')).toBe(false);
    for (const status of ACTIVE_STATUSES) expect(isActiveStatus(status)).toBe(true);
  });

  it('allows applying with no application, with a draft, and again after a rejection', () => {
    expect(applicationActions(null)).toEqual({ canApply: true, canWithdraw: false, canEditDraft: true });
    expect(applicationActions({ status: 'DRAFT' })).toEqual({ canApply: true, canWithdraw: false, canEditDraft: true });
    expect(applicationActions({ status: 'REJECTED' }).canApply).toBe(true);
  });

  it('allows withdrawing only a submitted application, and blocks everything for the other active states', () => {
    expect(applicationActions({ status: 'SUBMITTED' })).toEqual({ canApply: false, canWithdraw: true, canEditDraft: false });
    for (const status of ['UNDER_REVIEW', 'APPROVED', 'SUSPENDED'] as const) {
      expect(applicationActions({ status })).toEqual({ canApply: false, canWithdraw: false, canEditDraft: false });
    }
  });
});

describe('billing', () => {
  it('ships only the null provider, which reports "not configured" and never a balance', async () => {
    const provider = getBillingProvider();
    expect(provider).toBeInstanceOf(NullBillingProvider);
    expect(provider.configured).toBe(false);
    const unavailable = { status: 'unavailable', reason: 'not_configured' };
    expect(await provider.getBalance('c1')).toEqual(unavailable);
    expect(await provider.listLedgerEntries('c1')).toEqual(unavailable);
    expect(await provider.getPayoutReadiness('c1')).toEqual(unavailable);
    expect(await provider.requestPayout('c1', { amount: { amountMinor: 1, currency: 'IRR' }, idempotencyKey: 'k' })).toEqual(unavailable);
  });
});
