import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";

const includeWebKit = !existsSync("/etc/arch-release");

export default defineConfig({
  testDir: "./tests/browser",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: "https://localhost:4173",
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      grepInvert: /@camera-matrix/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      grep: /@camera-matrix/,
      use: { ...devices["Pixel 7"] },
    },
    ...(includeWebKit
      ? [{
          name: "mobile-webkit",
          grep: /@camera-matrix/,
          use: { ...devices["iPhone 15"] },
        }]
      : []),
  ],
  webServer: {
    command:
      "pnpm build && mkdir -p data/playwright-tests && node -e \"for (const name of ['application.sqlite','application.sqlite-shm','application.sqlite-wal']) require('node:fs').rmSync('data/playwright-tests/' + name, { force: true })\" && BROWSER_TLS_DIR=$(mktemp -d -p data/playwright-tests tls.XXXXXX) && openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=localhost -addext subjectAltName=DNS:localhost,IP:127.0.0.1 -keyout $BROWSER_TLS_DIR/key.pem -out $BROWSER_TLS_DIR/cert.pem >/dev/null 2>&1 && NODE_ENV=test SETUP_TEST_NOW=2026-01-01T09:30:00.000Z FOOD_LOG_TEST_NOW=2026-08-29T18:00:00.000Z FOOD_CATALOG_TEST_FIXTURE=1 DATABASE_PATH=data/playwright-tests/application.sqlite APPLICATION_URL=https://localhost:4173 node server/playwright-https.js $BROWSER_TLS_DIR/key.pem $BROWSER_TLS_DIR/cert.pem 4173",
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 120_000,
    url: "https://localhost:4173/health/live",
  },
});
