import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

Object.assign(process.env, { NODE_ENV: 'test' }); // NODE_ENV is typed read-only by Next
afterEach(() => cleanup());
