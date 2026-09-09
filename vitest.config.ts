import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      exclude: [
        "**/*.d.ts",
        // Deterministic browser-test adapters and host are tooling, not production.
        "app/**/test-fixture.server.ts",
        "server/playwright-https.js",
      ],
      include: ["app/**/*.{ts,tsx}", "server/**/*.{js,ts}", "server.js"],
      provider: "v8",
      reporter: ["text", "json"],
      thresholds: {
        branches: 95.01,
        functions: 95.01,
        lines: 95.01,
        statements: 95.01,
      },
    },
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
