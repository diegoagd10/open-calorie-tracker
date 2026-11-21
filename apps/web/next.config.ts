import type { NextConfig } from 'next'
import { fileURLToPath } from 'node:url'

const nextConfig: NextConfig = {
  // oxlint-disable-next-line local/no-comments
  // A self-contained server with only the files it needs, for the Docker image, which sets
  // NEXT_STANDALONE (`next start` refuses it). Traced from the workspace root, so packages/shared
  // comes along.
  ...(process.env['NEXT_STANDALONE'] === '1' ? { output: 'standalone' as const } : {}),
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  devIndicators: false,
  allowedDevOrigins: (process.env['ALLOWED_DEV_ORIGINS'] ?? '').split(',').filter(Boolean),
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
}

export default nextConfig
