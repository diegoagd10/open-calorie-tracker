import { defineConfig } from 'vite-plus'

export default defineConfig({
  run: {
    // Tests import the compiled packages/shared, so rebuild it first.
    tasks: {
      test: {
        command: 'vp test run',
        dependsOn: [{ task: 'build', from: 'dependencies' }],
        cache: false,
      },
      'test:cov': {
        command: 'vp test run --coverage',
        dependsOn: [{ task: 'build', from: 'dependencies' }],
        cache: false,
      },
    },
  },
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    include: ['src/**/*.spec.ts', 'test/**/*.e2e-spec.ts'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // seed.ts and reset.ts are development CLI scripts, not part of the API; config only reads
      // env vars.
      exclude: ['src/**/*.spec.ts', 'src/seed.ts', 'src/reset.ts', 'src/config/**'],
      // Fails `test:cov` when statement coverage drops below this.
      thresholds: { statements: 95 },
    },
  },
})
