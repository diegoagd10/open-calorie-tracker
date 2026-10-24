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
      // index.ts only re-exports and errors.ts only holds a message, so neither has logic to test.
      exclude: ['src/**/*.spec.ts', 'src/index.ts', 'src/errors.ts'],
      // Fails `test:cov` when statement coverage drops below this.
      thresholds: { statements: 95 },
    },
  },
})
