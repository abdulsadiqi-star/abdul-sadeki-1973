/**
 * Pure rules of the support flows (no I/O): video-reference parsing for takedown notices and the measurable
 * requirements of the verified-badge request. Everything here is unit-tested.
 */
import { VIDEO_ID_REGEX } from '@/lib/ids';

/**
 * Pull the video id out of whatever a claimant pasted: a watch URL, a shorts deep link, a path, or the bare id.
 * Returns `null` for anything else (including URLs that merely contain an 11-character word).
 */
export function parseVideoReference(input: string): string | null {
  const value = input.trim();
  if (VIDEO_ID_REGEX.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value, 'https://tamashagah.invalid');
  } catch {
    return null;
  }
  const watch = /^\/watch\/([0-9A-Za-z]{11})\/?$/.exec(url.pathname);
  if (watch) return watch[1]!;
  if (url.pathname.replace(/\/$/, '') === '/shorts') {
    const v = url.searchParams.get('v');
    if (v && VIDEO_ID_REGEX.test(v)) return v;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Verified badge
// ---------------------------------------------------------------------------

export const verificationRequirements = {
  /** The channel must have existed for at least this many days. */
  minChannelAgeDays: 30,
  /** …and have at least this many publicly listed videos. */
  minPublicVideos: 3,
  /** A short description proves the channel is set up (characters). */
  minDescriptionLength: 20,
} as const;

export type RequirementKey = 'email' | 'profile' | 'age' | 'videos';

export type RequirementState = {
  key: RequirementKey;
  met: boolean;
  /** Current value and target, for the progress text ("۲ از ۳"). */
  current: number;
  target: number;
};

export type VerificationFacts = {
  emailVerified: boolean;
  hasAvatar: boolean;
  descriptionLength: number;
  channelCreatedAt: Date;
  publicVideoCount: number;
  now: Date;
};

/** Evaluate the measurable requirements. Staff additionally review identity/notability by hand. */
export function evaluateVerificationRequirements(facts: VerificationFacts): { items: RequirementState[]; allMet: boolean } {
  const r = verificationRequirements;
  const ageDays = Math.max(0, Math.floor((facts.now.getTime() - facts.channelCreatedAt.getTime()) / 86_400_000));
  const items: RequirementState[] = [
    { key: 'email', met: facts.emailVerified, current: facts.emailVerified ? 1 : 0, target: 1 },
    {
      key: 'profile',
      met: facts.hasAvatar && facts.descriptionLength >= r.minDescriptionLength,
      current: (facts.hasAvatar ? 1 : 0) + (facts.descriptionLength >= r.minDescriptionLength ? 1 : 0),
      target: 2,
    },
    { key: 'age', met: ageDays >= r.minChannelAgeDays, current: Math.min(ageDays, r.minChannelAgeDays), target: r.minChannelAgeDays },
    { key: 'videos', met: facts.publicVideoCount >= r.minPublicVideos, current: Math.min(facts.publicVideoCount, r.minPublicVideos), target: r.minPublicVideos },
  ];
  return { items, allMet: items.every((i) => i.met) };
}

/** Requests that block a new one: the team has not decided yet. */
export const OPEN_VERIFICATION_STATUSES = ['SUBMITTED', 'UNDER_REVIEW'] as const;

/** Body of the first ticket message of a copyright notice (also what staff read in the admin panel). */
export function formatCopyrightNotice(input: {
  videoId: string;
  claimantName: string;
  contactEmail: string;
  workDescription: string;
  originalUrl: string;
  signature: string;
}): string {
  return [
    'شکایت حق تکثیر (درخواست حذف محتوا)',
    '',
    `ویدیوی مورد شکایت: /watch/${input.videoId}`,
    `شاکی: ${input.claimantName}`,
    `ایمیل تماس: ${input.contactEmail}`,
    input.originalUrl ? `نشانی اثر اصلی: ${input.originalUrl}` : null,
    '',
    'توضیح اثر و نحوه‌ی نقض:',
    input.workDescription,
    '',
    'بیانیه‌ها: شاکی با حسن نیت معتقد است استفاده‌ی مورد شکایت مجاز نیست و تأیید می‌کند اطلاعات این شکایت دقیق است و برای طرح آن اختیار قانونی دارد.',
    `امضای الکترونیک: ${input.signature}`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}
