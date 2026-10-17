import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id (the library default algorithm) with the OWASP-recommended minimum
 * profile: 19 MiB memory, 2 passes, 1 lane. Hashes are PHC strings that embed
 * their own parameters, so they can be upgraded transparently later.
 */
const OPTIONS = { memoryCost: 19_456, timeCost: 2, parallelism: 1, outputLen: 32 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/**
 * Burn roughly the same CPU time as a real verification so that "unknown
 * e-mail" and "wrong password" are indistinguishable by response time.
 */
export async function verifyAgainstDummy(password: string): Promise<void> {
  dummyHash ??= hashPassword('not-a-real-password-timing-equalizer');
  await verifyPassword(await dummyHash, password);
}
