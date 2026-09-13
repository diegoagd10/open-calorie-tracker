import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
import { catalogBrowserPorts } from "./scripts/catalog-browser-runtime";
const { public: publicPort, lan: lanPort } = catalogBrowserPorts;
const server = base.webServer as { command: string };
export default defineConfig({
  ...base,
  use: { ...base.use, baseURL: `https://localhost:${publicPort}` },
  testIgnore: [],
  testMatch: "catalog-settings.spec.ts",
  projects: [{ name: "chromium", use: { browserName: "chromium" } }, { name: "lan-chromium", use: { browserName: "chromium", baseURL: `http://127.0.0.1:${lanPort}` } }],
  webServer: { ...base.webServer, url: `https://localhost:${publicPort}/health/live`, command: server.command.replaceAll("4173", publicPort).replaceAll("4174", lanPort).replace("FOOD_CATALOG_TEST_FIXTURE=1", "FOOD_CATALOG_TEST_FIXTURE=0 CATALOG_BUILT_WORKER=1").replace("--import ./tests/browser/pi-oauth-fixture.mjs", "--import ./tests/browser/pi-oauth-fixture.mjs --import ./tests/browser/off-metadata-fixture.mjs") },
});
