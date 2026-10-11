import 'server-only';
import { PAGE_SIZE } from '../schemas';

export type PageInfo = { page: number; pageCount: number; total: number; pageSize: number; skip: number };

/** Offset pagination with the page clamped into range (a stale `?page=9` after a filter change shows the last page). */
export function paginate(total: number, requestedPage: number, pageSize = PAGE_SIZE): PageInfo {
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, requestedPage), pageCount);
  return { page, pageCount, total, pageSize, skip: (page - 1) * pageSize };
}

/** Case-insensitive substring filter (values are bound parameters — never interpolated into SQL). */
export const ciContains = (value: string) => ({ contains: value, mode: 'insensitive' as const });
