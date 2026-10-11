import { z } from 'zod';
import '@/lib/zod-fa';
import { emailSchema } from '@/features/auth/schemas';

/**
 * What a creator may send. Deliberately tiny and strict: there is NO status, id or channel field — the channel
 * comes from the session and the status is decided by the server's state machine (only reviewers can approve).
 */
export const applicationInputSchema = z
  .object({
    contactEmail: emailSchema,
    acceptTerms: z.boolean(),
  })
  .strict();

export type ApplicationFormInput = z.input<typeof applicationInputSchema>;
