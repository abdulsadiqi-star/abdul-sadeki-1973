/**
 * Reference data that must exist in EVERY environment (production included).
 * Applied by the migration `*_reference_categories` and refreshed by `pnpm db:seed`;
 * tests/unit/reference-data.test.ts keeps the three in sync.
 */
export const categories = [
  { slug: 'entertainment', nameFa: 'سرگرمی', nameEn: 'Entertainment', icon: 'tv' },
  { slug: 'movies', nameFa: 'فیلم و سریال', nameEn: 'Movies & Series', icon: 'film' },
  { slug: 'music', nameFa: 'موسیقی', nameEn: 'Music', icon: 'music' },
  { slug: 'sports', nameFa: 'ورزش', nameEn: 'Sports', icon: 'trophy' },
  { slug: 'gaming', nameFa: 'بازی', nameEn: 'Gaming', icon: 'gamepad' },
  { slug: 'education', nameFa: 'آموزش', nameEn: 'Education', icon: 'graduation' },
  { slug: 'news', nameFa: 'خبر', nameEn: 'News', icon: 'newspaper' },
  { slug: 'technology', nameFa: 'علم و فناوری', nameEn: 'Science & Technology', icon: 'cpu' },
  { slug: 'cooking', nameFa: 'آشپزی', nameEn: 'Cooking', icon: 'utensils' },
  { slug: 'kids', nameFa: 'کودک', nameEn: 'Kids', icon: 'baby' },
  { slug: 'travel', nameFa: 'سفر و گردشگری', nameEn: 'Travel', icon: 'plane' },
  { slug: 'comedy', nameFa: 'طنز', nameEn: 'Comedy', icon: 'laugh' },
  { slug: 'automotive', nameFa: 'خودرو', nameEn: 'Automotive', icon: 'car' },
  { slug: 'health', nameFa: 'سلامت', nameEn: 'Health', icon: 'heart' },
  { slug: 'art', nameFa: 'هنر و خلاقیت', nameEn: 'Art & Creativity', icon: 'palette' },
  { slug: 'business', nameFa: 'کسب‌وکار', nameEn: 'Business', icon: 'briefcase' },
  { slug: 'lifestyle', nameFa: 'سبک زندگی', nameEn: 'Lifestyle', icon: 'sparkles' },
] as const;
