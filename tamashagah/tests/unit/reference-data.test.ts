import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { categories } from '../../prisma/reference-data';

const root = path.resolve(import.meta.dirname, '../..');

describe('category reference data', () => {
  it('is identical in prisma/reference-data.ts (used by the seed) and the production data migration', () => {
    const dir = fs.readdirSync(path.join(root, 'prisma/migrations')).find((d) => d.endsWith('_reference_categories'));
    expect(dir, 'migration *_reference_categories exists').toBeTruthy();
    const sql = fs.readFileSync(path.join(root, 'prisma/migrations', dir!, 'migration.sql'), 'utf8');

    const rows = [...sql.matchAll(/\('cat_([^']+)', '([^']+)', '([^']+)', '([^']+)', '([^']+)', (\d+), true\)/g)].map((m) => ({
      id: `cat_${m[1]}`,
      slug: m[2],
      nameFa: m[3],
      nameEn: m[4],
      icon: m[5],
      sortOrder: Number(m[6]),
    }));

    expect(rows).toEqual(
      categories.map((c, index) => ({ id: `cat_${c.slug}`, slug: c.slug, nameFa: c.nameFa, nameEn: c.nameEn, icon: c.icon, sortOrder: index })),
    );
  });

  it('uses unique slugs that are safe in URLs', () => {
    const slugs = categories.map((c) => c.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const slug of slugs) expect(slug).toMatch(/^[a-z][a-z0-9-]*$/);
  });
});
