/**
 * Side-effect module: switches Zod's built-in messages to Persian.
 * Import it at the top of every `schemas.ts` (server AND client use the same schemas).
 */
import { z } from 'zod';

z.config(z.locales.fa());
