import { monetizationRequirements } from '@/config/site';

/**
 * Monetization eligibility — PURE math (no I/O), unit-tested. The numbers it is given come from real, persisted rows
 * (`features/monetization/queries.ts`): followers, watch hours of REAL view events in the last 365 days, public videos.
 */
export type Requirements = {
  readonly minFollowers: number;
  readonly minWatchHours: number;
  readonly minPublicVideos: number;
  readonly windowDays: number;
};

export type RequirementKey = 'followers' | 'watchHours' | 'publicVideos';

export type EligibilityInput = { followers: number; watchHours: number; publicVideos: number };

export type RequirementProgress = {
  key: RequirementKey;
  current: number;
  required: number;
  /** Exact comparison (`current >= required`): 499.96 of 500 hours is NOT met. */
  met: boolean;
  /** 0…1, capped. */
  progress: number;
  /** What is still missing (0 when met). */
  remaining: number;
};

export type Eligibility = {
  items: RequirementProgress[];
  /** Every requirement is met. */
  eligible: boolean;
  missing: RequirementProgress[];
};

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

function progressOf(key: RequirementKey, current: number, required: number): RequirementProgress {
  const safeCurrent = Number.isFinite(current) ? Math.max(0, current) : 0;
  const met = safeCurrent >= required;
  return {
    key,
    current: safeCurrent,
    required,
    met,
    progress: required <= 0 ? 1 : clamp01(safeCurrent / required),
    remaining: met ? 0 : required - safeCurrent,
  };
}

export function computeEligibility(input: EligibilityInput, requirements: Requirements = monetizationRequirements): Eligibility {
  const items = [
    progressOf('followers', input.followers, requirements.minFollowers),
    progressOf('watchHours', input.watchHours, requirements.minWatchHours),
    progressOf('publicVideos', input.publicVideos, requirements.minPublicVideos),
  ];
  const missing = items.filter((item) => !item.met);
  return { items, eligible: missing.length === 0, missing };
}

/**
 * Round DOWN to `digits` decimals for display, so a value just below a threshold is never shown as the threshold
 * ("۵۰۰ از ۵۰۰ ساعت" next to an unmet requirement would be a lie).
 */
export function floorTo(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.floor(value * factor + 1e-9) / factor;
}

/** Round UP to `digits` decimals ("what is still missing" never under-reports). */
export function ceilTo(value: number, digits = 1): number {
  const factor = 10 ** digits;
  return Math.ceil(value * factor - 1e-9) / factor;
}
