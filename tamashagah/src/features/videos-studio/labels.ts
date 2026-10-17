/**
 * Persian copy of the studio video features (kept here, not in `lib/i18n/fa.ts`, to avoid merge conflicts).
 * Plain data: usable from Server and Client Components.
 */

export const studioTabs = [
  { value: 'all', label: 'همه ویدیوها' },
  { value: 'unpublished', label: 'منتشر نشده' },
  { value: 'scheduled', label: 'زمان‌بندی‌شده' },
  { value: 'processing', label: 'در حال پردازش' },
  { value: 'failed', label: 'ناموفق' },
  { value: 'shorts', label: 'شورتس' },
] as const;

export type StudioTab = (typeof studioTabs)[number]['value'];

export const studioSorts = [
  { value: 'newest', label: 'جدیدترین' },
  { value: 'oldest', label: 'قدیمی‌ترین' },
  { value: 'views', label: 'پربازدیدترین' },
  { value: 'likes', label: 'بیشترین پسند' },
] as const;

export type StudioSort = (typeof studioSorts)[number]['value'];

export const publishModes = [
  { value: 'PUBLISH', label: 'انتشار فوری', hint: 'به‌محض آماده‌شدن پردازش منتشر می‌شود.' },
  { value: 'SCHEDULE', label: 'زمان‌بندی', hint: 'در تاریخ و ساعت انتخابی منتشر می‌شود.' },
  { value: 'DRAFT', label: 'پیش‌نویس', hint: 'منتشر نمی‌شود تا خودتان آن را منتشر کنید.' },
] as const;

export const kindChoices = [
  { value: 'auto', label: 'تشخیص خودکار', hint: 'ویدیوهای عمودی یا مربعِ کوتاه‌تر از ۹۰ ثانیه به‌صورت شورتس منتشر می‌شوند.' },
  { value: 'VIDEO', label: 'ویدیوی معمولی', hint: 'حتی اگر عمودی و کوتاه باشد، ویدیوی عادی می‌ماند.' },
  { value: 'SHORT', label: 'شورتس', hint: 'در بخش شورتس نمایش داده می‌شود.' },
] as const;

/** Languages a video / subtitle can declare (BCP-47 primary subtag → Persian name). */
export const videoLanguages = [
  { code: 'fa', label: 'فارسی' },
  { code: 'en', label: 'انگلیسی' },
  { code: 'ar', label: 'عربی' },
  { code: 'tr', label: 'ترکی' },
  { code: 'az', label: 'آذری' },
  { code: 'ku', label: 'کردی' },
  { code: 'ru', label: 'روسی' },
  { code: 'fr', label: 'فرانسوی' },
  { code: 'de', label: 'آلمانی' },
  { code: 'es', label: 'اسپانیایی' },
  { code: 'zh', label: 'چینی' },
  { code: 'hi', label: 'هندی' },
  { code: 'ur', label: 'اردو' },
] as const;

export const languageCodes = videoLanguages.map((l) => l.code) as [string, ...string[]];

export const languageLabel = (code: string | null | undefined): string =>
  videoLanguages.find((l) => l.code === code)?.label ?? code ?? '';

export const studioMessages = {
  saved: 'تغییرات ذخیره شد.',
  deleted: 'ویدیو حذف شد.',
  retryQueued: 'ویدیو دوباره در صف پردازش قرار گرفت.',
  thumbnailChanged: 'تصویر بندانگشتی تغییر کرد.',
  subtitleAdded: 'زیرنویس افزوده شد.',
  subtitleRemoved: 'زیرنویس حذف شد.',
  notFound: 'ویدیو پیدا نشد.',
  scheduleInPast: 'زمان انتشار باید در آینده باشد.',
  scheduleTooFar: 'زمان‌بندی بیش از یک سال آینده ممکن نیست.',
  scheduleRequired: 'برای زمان‌بندی، تاریخ و ساعت انتشار را انتخاب کنید.',
  categoryInvalid: 'دسته‌بندی انتخاب‌شده معتبر نیست.',
  notReady: 'این کار فقط برای ویدیوهای آماده‌شده ممکن است.',
  sourceGone: 'فایل اصلی این ویدیو دیگر در دسترس نیست؛ لطفاً دوباره بارگذاری کنید.',
} as const;
