import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Self-contained server bundle for a small Docker image.
  output: 'standalone',
  // Trace files from the monorepo root so workspace packages are included in the bundle.
  outputFileTracingRoot: path.resolve(import.meta.dirname, '../..'),
  // Workspace packages are shipped as TypeScript source.
  transpilePackages: ['@ircub/core', '@ircub/db', '@ircub/platform'],
  // Native / file-reading packages must be loaded by Node at runtime, not bundled.
  serverExternalPackages: ['@node-rs/argon2', 'pdfkit', 'pino', 'bullmq', 'ioredis', 'pg'],
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
