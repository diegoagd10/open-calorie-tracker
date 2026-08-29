import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:4173",
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: {
    command:
      "pnpm build && mkdir -p data/playwright-tests && AUTH_TEST_DB_PATH=$(mktemp -p data/playwright-tests application.XXXXXX.sqlite) && NODE_ENV=test SETUP_TEST_NOW=2026-01-01T09:30:00.000Z FOOD_LOG_TEST_NOW=2026-08-29T18:00:00.000Z DATABASE_PATH=$AUTH_TEST_DB_PATH APPLICATION_URL=http://127.0.0.1:4173 PORT=4173 node server.js",
    reuseExistingServer: false,
    timeout: 120_000,
    url: "http://127.0.0.1:4173/health/live",
  },
});
