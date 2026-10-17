/**
 * Keyset ("seek") pagination helper for lists ordered by `createdAt` with `id` as the tie-breaker.
 *
 * Why not Prisma's `cursor` + `skip: 1`? That pair positions itself on the cursor ROW and skips it, which silently
 * drops the next row whenever the cursor row no longer matches the filter by the time the next page is requested
 * (a notification marked read while viewing the unread list, a comment deleted by its author, …). Comparing the
 * sort keys instead never depends on the cursor row still being part of the result set.
 */
export type KeysetCursor = { createdAt: Date; id: string };

/** `where` fragment selecting rows strictly after `cursor` in `createdAt DESC, id DESC` (default) or ASC order. */
export function keysetAfter(cursor: KeysetCursor, direction: 'desc' | 'asc' = 'desc') {
  return direction === 'desc'
    ? { OR: [{ createdAt: { lt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { lt: cursor.id } }] }
    : { OR: [{ createdAt: { gt: cursor.createdAt } }, { createdAt: cursor.createdAt, id: { gt: cursor.id } }] };
}
