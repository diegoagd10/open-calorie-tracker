import { join } from 'node:path'
import { defineConfig } from 'vite-plus'

export default defineConfig({
  resolve: { alias: { '@': join(import.meta.dirname, '../../../apps/web/src') } },
  test: {
    root: import.meta.dirname,
    include: ['days.spec.ts'],
    pool: 'forks',
    silent: false,
    disableConsoleIntercept: true,
    testTimeout: 300_000,
  },
})
