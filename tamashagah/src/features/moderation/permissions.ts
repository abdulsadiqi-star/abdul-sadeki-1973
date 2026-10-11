import { Errors } from '@/lib/errors';
import type { PolicyResult } from '@/features/admin/policy';

/** Turn a failed policy verdict into the matching `AppError` (403 for rules, 409 when nothing would change). */
export function assertAllowed(result: PolicyResult): void {
  if (result.ok) return;
  throw result.reason === 'NO_CHANGE' ? Errors.conflict(result.message) : Errors.forbidden(result.message);
}
