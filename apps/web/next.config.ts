import type { NextConfig } from 'next'
import { fileURLToPath } from 'node:url'

const nextConfig: NextConfig = {
  // A self-contained server with only the files it needs, for the Docker image, which sets
  // NEXT_STANDALONE (`next start` refuses it). Traced from the workspace root, so packages/shared
  // comes along.
  ...(process.env['NEXT_STANDALONE'] === '1' ? { output: 'standalone' as const } : {}),
  outputFileTracingRoot: fileURLToPath(new URL('../..', import.meta.url)),
  // Hides the Next.js badge shown in the corner during development.
  devIndicators: false,
  // Hosts other than localhost that may load `next dev` resources, e.g. to test on a phone.
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
