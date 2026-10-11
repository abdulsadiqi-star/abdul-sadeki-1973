import { z } from 'zod';

export type ChannelLink = { title: string; url: string };

const linkSchema = z.object({
  title: z.string().trim().min(1).max(80),
  url: z
    .string()
    .trim()
    .max(500)
    .refine((value) => {
      try {
        const u = new URL(value);
        return u.protocol === 'https:' || u.protocol === 'http:';
      } catch {
        return false;
      }
    }),
});

/**
 * `Channel.links` is free-form JSON written by the studio settings. Never render it blindly: keep only well-formed
 * http(s) entries (no `javascript:`/`data:` URLs), cap the count, and drop everything else.
 */
export function parseChannelLinks(raw: unknown, max = 10): ChannelLink[] {
  if (!Array.isArray(raw)) return [];
  const out: ChannelLink[] = [];
  for (const entry of raw) {
    const parsed = linkSchema.safeParse(entry);
    if (parsed.success) out.push(parsed.data);
    if (out.length >= max) break;
  }
  return out;
}

/** Host part for display ("example.org"), falling back to the raw URL. */
export function linkHost(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
