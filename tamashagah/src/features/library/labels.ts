/** Persian copy of the library (kept here, not in lib/i18n, to avoid merge conflicts). */

export const playlistVisibilityHint = {
  PRIVATE: 'فقط شما می‌توانید این لیست را ببینید.',
  UNLISTED: 'هر کسی که پیوند لیست را داشته باشد می‌تواند آن را ببیند؛ در صفحه‌ی کانال شما نمایش داده نمی‌شود.',
  PUBLIC: 'همه می‌توانند این لیست را ببینند و در صفحه‌ی کانال شما نمایش داده می‌شود.',
} as const;

export const libraryTabLabels = {
  overview: 'همه',
  history: 'تاریخچه',
  'watch-later': 'بعداً تماشا می‌کنم',
  liked: 'پسندیده‌ها',
  following: 'کانال‌ها',
  playlists: 'لیست‌های پخش',
} as const;

export const libraryTabTitles = {
  history: 'تاریخچه‌ی تماشا',
  'watch-later': 'بعداً تماشا می‌کنم',
  liked: 'ویدیوهای پسندیده',
  following: 'کانال‌های دنبال‌شده',
  playlists: 'لیست‌های پخش',
} as const;
