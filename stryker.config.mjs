/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  plugins: ["@stryker-mutator/vitest-runner"],
  testRunner: "vitest",
  vitest: {
    configFile: "vitest.config.ts",
  },
  mutate: [
    // All JavaScript and TypeScript shipped by the application is eligible.
    // Keeping the allowlist to these production roots also excludes, by design:
    // - drizzle/: generated migrations and snapshots are immutable DB history.
    // - .react-router/: generated route types are derived during typecheck.
    "app/**/*.{js,jsx,ts,tsx}",
    "server/**/*.{js,jsx,ts,tsx}",
    "server.js",

    // Deferred by risk review: these files only compose already-tested services
    // at process startup. Keep behavioral modules in scope while the bootstrap
    // and runtime wiring receive their own future integration-test pass.
    "!server.js",
    "!server/app.ts",
    "!app/**/runtime.server.ts",

    // Declarations describe types but contain no executable behavior.
    "!**/*.d.ts",
    "!**/*.d.mts",
  ],
  concurrency: 4,
  coverageAnalysis: "perTest",
  incremental: true,
  incrementalFile: "reports/stryker-incremental.json",
  reporters: ["progress", "html", "json"],
  htmlReporter: {
    fileName: "reports/mutation/mutation.html",
  },
  jsonReporter: {
    fileName: "reports/mutation/mutation.json",
  },
};

export default config;
