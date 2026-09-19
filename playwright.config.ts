import { existsSync } from "node:fs";

import { defineConfig, devices } from "@playwright/test";
import { playwrightBrowserPorts } from "./scripts/catalog-browser-runtime";

const includeWebKit = !existsSync("/etc/arch-release");
const serverCommand =
  "pnpm build && mkdir -p data/playwright-tests && node -e \"for (const name of ['application.sqlite','application.sqlite-shm','application.sqlite-wal']) require('node:fs').rmSync('data/playwright-tests/' + name, { force: true })\" && BROWSER_TLS_DIR=$(mktemp -d -p data/playwright-tests tls.XXXXXX) && openssl req -x509 -newkey rsa:2048 -nodes -days 1 -subj /CN=localhost -addext subjectAltName=DNS:localhost,IP:127.0.0.1 -keyout $BROWSER_TLS_DIR/key.pem -out $BROWSER_TLS_DIR/cert.pem >/dev/null 2>&1 && NODE_ENV=test WEBAUTHN_ENROLLMENT_PREVIEW=1 SETUP_TEST_NOW=2026-01-01T09:30:00.000Z FOOD_LOG_TEST_NOW=2026-08-29T18:00:00.000Z PHOTO_ANALYSIS_TEST_FIXTURE=1 PHOTO_CREDENTIAL_VALIDATION_TEST_FIXTURE=1 FOOD_CATALOG_TEST_FIXTURE=1 PHOTO_AI_AUTH_PATH=data/playwright-tests/pi/auth.json APPLICATION_SECRETS_PATH=data/playwright-tests/secrets DATABASE_PATH=data/playwright-tests/application.sqlite LAN_URL=http://127.0.0.1:4174 LAN_PORT=4174 APPLICATION_URL=https://localhost:4173 node --import ./tests/browser/pi-oauth-fixture.mjs server/playwright-https.js $BROWSER_TLS_DIR/key.pem $BROWSER_TLS_DIR/cert.pem 4173 4174"
    .replaceAll("4173", playwrightBrowserPorts.public)
    .replaceAll("4174", playwrightBrowserPorts.lan);

export default defineConfig({
  testDir: "./tests/browser",
  testIgnore: "**/catalog-settings.spec.ts",
  fullyParallel: false,
  workers: 1,
  use: {
    baseURL: `https://localhost:${playwrightBrowserPorts.public}`,
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
      name: "lan-chromium",
      grepInvert: /@camera-matrix/,
      use: {
        ...devices["Desktop Chrome"],
        baseURL: `http://127.0.0.1:${playwrightBrowserPorts.lan}`,
      },
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
    command: serverCommand,
    ignoreHTTPSErrors: true,
    reuseExistingServer: false,
    timeout: 120_000,
    url: `https://localhost:${playwrightBrowserPorts.public}/health/live`,
  },
});
