import { defineConfig } from 'vite-plus'

export default defineConfig({
  test: {
    root: import.meta.dirname,
    include: ['replay.spec.ts'],
    silent: false,
    disableConsoleIntercept: true,
    testTimeout: 300_000,
  },
})
