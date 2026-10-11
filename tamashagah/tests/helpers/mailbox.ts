import fs from 'node:fs/promises';
import path from 'node:path';

export type CapturedMail = { to: string; subject: string; text: string; html: string };

/** Mails written by MAIL_TRANSPORT=file, oldest first. */
export async function readMailbox(dir = process.env.MAIL_FILE_DIR!): Promise<CapturedMail[]> {
  let files: string[] = [];
  try {
    files = (await fs.readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return [];
  }
  return Promise.all(files.map(async (f) => JSON.parse(await fs.readFile(path.join(dir, f), 'utf8')) as CapturedMail));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Extract the one-time token from the newest verify/reset mail sent to `to`.
 * Mail delivery is fire-and-forget, so this polls until at least `minCount`
 * matching mails exist (default 1) or the timeout elapses.
 */
export async function lastTokenFor(
  to: string,
  kind: 'verify-email' | 'reset-password',
  opts: { minCount?: number; timeoutMs?: number } = {},
): Promise<string> {
  const { minCount = 1, timeoutMs = 4_000 } = opts;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const mails = (await readMailbox()).filter((m) => m.to === to && m.text.includes(`/${kind}?token=`));
    if (mails.length >= minCount) {
      const match = /token=([A-Za-z0-9_-]+)/.exec(mails.at(-1)!.text);
      if (!match) throw new Error('Token not found in mail');
      return match[1]!;
    }
    if (Date.now() > deadline) throw new Error(`No ${kind} mail for ${to} (waited ${timeoutMs}ms)`);
    await sleep(50);
  }
}
