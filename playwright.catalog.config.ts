import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
const server = base.webServer as { command: string };
export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: "catalog-settings.spec.ts",
  projects: [{ name: "chromium", use: { browserName: "chromium" } }, { name: "lan-chromium", use: { browserName: "chromium", baseURL: "http://127.0.0.1:4174" } }],
  webServer: { ...base.webServer, command: server.command.replace("FOOD_CATALOG_TEST_FIXTURE=1", "FOOD_CATALOG_TEST_FIXTURE=0 CATALOG_BUILT_WORKER=1 OFF_CATALOG_MAX_DATABASE_BYTES=1073741824 OFF_CATALOG_MAX_EXPANDED_BYTES=1073741824 OFF_CATALOG_MAX_UPLOAD_BYTES=16777216").replace("--import ./tests/browser/pi-oauth-fixture.mjs", "--import ./tests/browser/pi-oauth-fixture.mjs --import ./tests/browser/off-metadata-fixture.mjs") },
});
