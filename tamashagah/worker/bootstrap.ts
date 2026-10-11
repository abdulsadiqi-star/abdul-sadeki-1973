/**
 * Must be the FIRST import of `worker/index.ts`: the shared logger reads `SERVICE_NAME` when it is first imported,
 * and ES module imports are evaluated in order, so this has to run before anything that imports `@/lib/logger`.
 */
process.env.SERVICE_NAME ??= 'worker';

export {};
