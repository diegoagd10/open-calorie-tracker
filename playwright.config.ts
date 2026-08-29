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
      "pnpm build && DATABASE_PATH=test-results/playwright/application.sqlite PORT=4173 pnpm start",
    reuseExistingServer: false,
    timeout: 120_000,
    url: "http://127.0.0.1:4173/",
  },
});
