import { defineConfig } from "@playwright/test";
import base from "./playwright.config";
const server = base.webServer as { command: string };
export default defineConfig({
  ...base,
  testIgnore: [],
  testMatch: "catalog-settings.spec.ts",
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: { ...base.webServer, command: server.command.replace("FOOD_CATALOG_TEST_FIXTURE=1", "FOOD_CATALOG_TEST_FIXTURE=0 CATALOG_BUILT_WORKER=1") },
});
