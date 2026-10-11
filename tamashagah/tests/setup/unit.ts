// Deterministic defaults for unit tests (no real services are touched).
Object.assign(process.env, { NODE_ENV: 'test' }); // NODE_ENV is typed read-only by Next
process.env.DATABASE_URL ??= 'postgresql://unit:unit@127.0.0.1:5432/unit';
process.env.SESSION_SECRET ??= 'unit-test-secret-0123456789abcdef0123456789abcdef';
process.env.APP_URL ??= 'http://localhost:3000';
