import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      exclude: [
        "**/*.d.ts",
        // Deterministic browser-test adapter; it is never selected in production.
        "app/catalog/test-fixture.server.ts",
      ],
      include: ["app/**/*.{ts,tsx}", "server/**/*.{js,ts}", "server.js"],
      provider: "v8",
      reporter: ["text", "json"],
    },
    include: ["tests/**/*.test.ts"],
  },
});
