import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Hides the Next.js badge shown in the corner during development.
  devIndicators: false,
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
