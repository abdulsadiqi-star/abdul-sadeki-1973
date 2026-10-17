/** URL of the dedicated integration-test database: DATABASE_URL_TEST, or DATABASE_URL with "_test" appended to the db name. */
export function testDatabaseUrl(): string {
  if (process.env.DATABASE_URL_TEST) return process.env.DATABASE_URL_TEST;
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('Set DATABASE_URL_TEST (or DATABASE_URL) to run integration tests.');
  const url = new URL(base);
  if (!url.pathname.endsWith('_test')) url.pathname = `${url.pathname}_test`;
  return url.toString();
}
