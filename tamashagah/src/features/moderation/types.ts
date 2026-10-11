import type { Prisma } from '@/generated/prisma/client';
import type { UserRole } from '@/generated/prisma/enums';

/** The signed-in staff member performing a moderation operation (derived from the database per request). */
export type Staff = { id: string; role: UserRole; displayName: string };

export type Tx = Prisma.TransactionClient;

/** Targets a report can point at. */
export type TargetRef = { type: 'VIDEO'; id: string } | { type: 'COMMENT'; id: string } | { type: 'CHANNEL'; id: string };
