import { startSession } from '@/lib/auth/session';
import { requestContext } from './request-context';

/** Make the mocked request context act as `userId` (creates a real DB session + cookie). */
export async function loginAs(userId: string): Promise<void> {
  requestContext.reset();
  await startSession(userId);
}

/** Back to an anonymous visitor. */
export function logout(): void {
  requestContext.reset();
}
