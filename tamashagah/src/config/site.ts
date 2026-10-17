/**
 * Brand and product constants. The brand is intentionally easy to rename:
 * change `name` / `nameEn` here and replace the <Logo /> component.
 */
export const siteConfig = {
  name: 'تماشاگاه',
  nameEn: 'Tamashagah',
  tagline: 'جایی برای دیدن، ساختن و به اشتراک گذاشتن',
  description:
    'تماشاگاه یک پلتفرم فارسی اشتراک‌گذاری ویدیو است؛ ویدیو بارگذاری کنید، کانال بسازید و با مخاطبان خود در ارتباط باشید.',
  supportEmail: 'support@example.com',
  /** Cookie that stores the user's numeral preference for logged-out visitors. */
  digitsCookie: 'tg_digits',
  /** Cookie that remembers the collapsed state of the desktop sidebar. */
  sidebarCookie: 'tg_sidebar',
} as const;

export const SHORTS_MAX_SECONDS = 90;

/** Eligibility thresholds shown on the monetization page (all computed from real data). */
export const monetizationRequirements = {
  minFollowers: 1_000,
  minWatchHours: 500,
  minPublicVideos: 5,
  windowDays: 365,
} as const;
