import { defineConfig } from 'vite-plus'

export default defineConfig({
  pack: {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
  },
  test: {
    include: ['src/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.spec.ts', 'src/index.ts'],
      // Fails `test:cov` when any metric drops below this.
      thresholds: { statements: 95, branches: 95, functions: 95, lines: 95 },
    },
  },
})
