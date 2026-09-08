import { availableParallelism } from "node:os";
import { readMutationShard, planMutationShards, readMutationSources } from "./scripts/mutation-shards.mjs";

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  plugins: ["@stryker-mutator/vitest-runner"],
  testRunner: "vitest",
  vitest: {
    configFile: "vitest.config.ts",
    // Per-test mutation coverage includes real workers; Vite's import graph does
    // not include those runtime entry points and would filter their tests out.
    related: false,
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
    "!server/http-host.js",
    "!server/playwright-https.js",
    "!app/**/runtime.server.ts",

    // Declarations describe types but contain no executable behavior.
    "!**/*.d.ts",
    "!**/*.d.mts",
  ],
  concurrency: Math.min(4, availableParallelism()),
  coverageAnalysis: "perTest",
  ignoreStatic: true,
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

export const mutationShard = readMutationShard();
export const mutationSources = await readMutationSources(config.mutate);
if (mutationShard) {
  config.mutate = planMutationShards(mutationSources, mutationShard.total)[mutationShard.index - 1].mutate;
  if (config.mutate.length === 0) throw new Error("Mutation shard has no source statements");
}

export default config;
