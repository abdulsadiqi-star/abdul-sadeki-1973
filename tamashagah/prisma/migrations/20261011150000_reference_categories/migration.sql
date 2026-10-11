-- Reference data: the category catalogue exists in every environment (the app needs it to upload and browse).
-- Idempotent; keep in sync with prisma/reference-data.ts (tests/unit/reference-data.test.ts enforces it).
INSERT INTO "Category" ("id", "slug", "nameFa", "nameEn", "icon", "sortOrder", "isActive")
VALUES
  ('cat_entertainment', 'entertainment', 'سرگرمی', 'Entertainment', 'tv', 0, true),
  ('cat_movies', 'movies', 'فیلم و سریال', 'Movies & Series', 'film', 1, true),
  ('cat_music', 'music', 'موسیقی', 'Music', 'music', 2, true),
  ('cat_sports', 'sports', 'ورزش', 'Sports', 'trophy', 3, true),
  ('cat_gaming', 'gaming', 'بازی', 'Gaming', 'gamepad', 4, true),
  ('cat_education', 'education', 'آموزش', 'Education', 'graduation', 5, true),
  ('cat_news', 'news', 'خبر', 'News', 'newspaper', 6, true),
  ('cat_technology', 'technology', 'علم و فناوری', 'Science & Technology', 'cpu', 7, true),
  ('cat_cooking', 'cooking', 'آشپزی', 'Cooking', 'utensils', 8, true),
  ('cat_kids', 'kids', 'کودک', 'Kids', 'baby', 9, true),
  ('cat_travel', 'travel', 'سفر و گردشگری', 'Travel', 'plane', 10, true),
  ('cat_comedy', 'comedy', 'طنز', 'Comedy', 'laugh', 11, true),
  ('cat_automotive', 'automotive', 'خودرو', 'Automotive', 'car', 12, true),
  ('cat_health', 'health', 'سلامت', 'Health', 'heart', 13, true),
  ('cat_art', 'art', 'هنر و خلاقیت', 'Art & Creativity', 'palette', 14, true),
  ('cat_business', 'business', 'کسب‌وکار', 'Business', 'briefcase', 15, true),
  ('cat_lifestyle', 'lifestyle', 'سبک زندگی', 'Lifestyle', 'sparkles', 16, true)
ON CONFLICT ("slug") DO NOTHING;
