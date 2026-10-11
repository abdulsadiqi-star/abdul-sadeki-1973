/**
 * SQL fragments shared by the analytics queries.
 *
 * WHY the double conversion: Prisma stores `DateTime` as `timestamp(3) WITHOUT time zone` holding UTC. In
 * PostgreSQL `naive_ts AT TIME ZONE 'Asia/Tehran'` would *interpret the UTC clock as Tehran wall time*
 * (and return a timestamptz) — silently shifting every bucket by 3.5 hours. The correct bucketing first
 * declares the naive value to be UTC and only then converts to Tehran local time:
 *
 *     date_trunc('day', (col AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tehran')
 *
 * Bounds are compared the other way round (`timestamptz AT TIME ZONE 'UTC'` → naive UTC) so plain index range
 * scans are used and the result never depends on the session `TimeZone` setting.
 */
import { Prisma } from '@/generated/prisma/client';

/** Naive-UTC timestamp for comparing with Prisma's `timestamp(3)` columns. */
export const utcBound = (instant: Date): Prisma.Sql => Prisma.sql`(${instant.toISOString()}::timestamptz AT TIME ZONE 'UTC')`;

/** Only these literal column references may be turned into a Tehran-day expression (no dynamic identifiers). */
type TimestampColumn = 'e."createdAt"' | 'l."createdAt"' | 'c."createdAt"' | 'f."createdAt"';

/** `'YYYY-MM-DD'` of the Tehran calendar day a UTC-naive timestamp column falls in. */
export const tehranDayOf = (column: TimestampColumn): Prisma.Sql =>
  Prisma.sql`to_char(date_trunc('day', (${Prisma.raw(column)} AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Tehran'), 'YYYY-MM-DD')`;
