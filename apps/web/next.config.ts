import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
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
