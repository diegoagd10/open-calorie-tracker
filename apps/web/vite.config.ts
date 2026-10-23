import { defineConfig } from 'vite-plus'

export default defineConfig({
  test: {
    include: ['test/**/*.e2e-spec.ts'],
    passWithNoTests: true,
    globalSetup: ['./test/servers.ts'],
    // The first request to `next dev` compiles the page.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
