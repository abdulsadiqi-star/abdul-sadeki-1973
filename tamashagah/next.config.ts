import type { NextConfig } from 'next';

const isProd = process.env.NODE_ENV === 'production';

/** Origins media may come from when MEDIA_DELIVERY=redirect (presigned S3 URLs). */
function storageOrigin(): string {
  try {
    return process.env.S3_ENDPOINT ? new URL(process.env.S3_ENDPOINT).origin : '';
  } catch {
    return '';
  }
}

// CSP (production only: the dev server needs eval/websockets for HMR).
// 'unsafe-inline' scripts are required by Next.js without per-request nonces; everything else is locked down.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${storageOrigin()}`.trim(),
  `media-src 'self' blob: ${storageOrigin()}`.trim(),
  `connect-src 'self' ${storageOrigin()}`.trim(),
  "font-src 'self' data:",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
].join('; ');

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  // microphone=(self) is needed for in-browser voice search.
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=(), payment=(), usb=()' },
  ...(isProd
    ? [
        { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
        { key: 'Content-Security-Policy', value: csp },
      ]
    : []),
];

const nextConfig: NextConfig = {
  // `standalone` is enabled by the Docker build (NEXT_OUTPUT=standalone); plain `next start` is used locally.
  output: process.env.NEXT_OUTPUT === 'standalone' ? 'standalone' : undefined,
  reactStrictMode: true,
  poweredByHeader: false,
  // Catches broken internal links at compile time (<Link href> must be a real route).
  typedRoutes: true,
  // Native / Node-only packages must not be bundled into the server build.
  serverExternalPackages: [
    '@node-rs/argon2',
    'pino',
    'bullmq',
    'ioredis',
    'nodemailer',
    'pg',
    'sharp',
    '@aws-sdk/client-s3',
    '@aws-sdk/lib-storage',
    '@aws-sdk/s3-request-presigner',
    '@tus/server',
    '@tus/file-store',
    '@tus/s3-store',
  ],
  experimental: {
    serverActions: { bodySizeLimit: '2mb' },
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
