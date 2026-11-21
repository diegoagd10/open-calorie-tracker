import { defineConfig } from 'vite-plus'

export default defineConfig({
  run: {
    tasks: {
      test: {
        command: 'vp test run',
        dependsOn: [{ task: 'build', from: 'dependencies' }],
        cache: false,
      },
    },
  },
  test: {
    include: ['test/**/*.e2e-spec.ts'],
    passWithNoTests: true,
    globalSetup: ['./test/servers.ts'],
    // oxlint-disable-next-line local/no-comments
    // The first request to `next dev` compiles the page.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
})
