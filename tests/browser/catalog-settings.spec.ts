import { execFile, spawn } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { runCatalogImportCommand } from "../../server/import-catalog";
import { catalogBrowserPorts } from "../../scripts/catalog-browser-runtime";
import type { Page } from "@playwright/test";
import { createServer } from "node:net";
import { once } from "node:events";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { installSimulatedBarcodeCamera } from "./barcode-camera-fixture";
import AxeBuilder from "@axe-core/playwright";
import { bootstrapOrSignInBrowserTestUser, configureBarcodeContact, expect, signInProvisionedMember, test, submitPasswordLogin } from "./reset-database";
import { basicFoodsArchive } from "../support/basic-foods-archive";

const password = "correct horse 🔐 battery";
test.setTimeout(120_000);
async function commandImport(provider: "usda-fdc", filename: string, archive: Buffer, succeeds = true) {
  const directory = path.resolve("data/playwright-tests");
  const archivePath = path.join(directory, filename);
  await writeFile(archivePath, archive);
  try {
    const result = await promisify(execFile)(process.execPath, ["build/catalog-command/import-catalog.js", provider, "--", archivePath], {
      env: { ...process.env, PORT: catalogBrowserPorts.lan, DATABASE_PATH: path.join(directory, "application.sqlite"), CATALOG_DIRECTORY: path.join(directory, "catalogs") },
    }).then(result => ({ ...result, code: 0 }), (error: { code: number; stdout: string; stderr: string }) => error);
    expect(result.code).toBe(succeeds ? 0 : 1);
    expect(succeeds ? result.stdout : result.stderr).toContain(succeeds ? "succeeded;" : "import failed:");
  } finally { await rm(archivePath, { force: true }); }
}
function toast(page: Page) {
  return page.getByRole("status").filter({ has: page.getByRole("button", { name: "Dismiss notification" }) });
}

test("terminal imports notify connected clients while a member searches and logs local foods", async ({ page, browser }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await bootstrapOrSignInBrowserTestUser(page, "catalog.browser.admin", password);
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL("/");
  expect((await page.goto("/?food=search&query=broccoli"))?.status()).toBe(503);
  await expect(page.getByRole("heading", { name: "USDA Foundation is not installed" })).toBeVisible();
  await page.goto("/settings/goals");
  await page.getByRole("link", { name: /Food Catalogs/ }).click();
  await expect(page.getByRole("heading", { name: "Food Catalogs", exact: true })).toBeVisible();
  const usdaCard = page.locator('section[aria-labelledby="usda-fdc-heading"]');
  await expect(usdaCard.getByText("Install a Foundation archive before comparing it with USDA's declared release.", { exact: true })).toBeVisible();
  const officialDownload = usdaCard.getByRole("link", { name: /Official USDA downloads/ });
  await expect(officialDownload).toHaveAttribute("href", "https://fdc.nal.usda.gov/download-datasets/");
  await expect(officialDownload).toHaveAttribute("target", "_blank");
  await usdaCard.getByRole("button", { name: "Check USDA updates again" }).click();
  await expect(page.locator('input[type="file"], progress')).toHaveCount(0);
  const memberContexts = await Promise.all([browser.newContext({ baseURL: new URL(page.url()).origin, ignoreHTTPSErrors: true }), browser.newContext({ baseURL: new URL(page.url()).origin, ignoreHTTPSErrors: true })]);
  const members = await Promise.all(memberContexts.map(async (context, index) => {
    const member = await context.newPage();
    await signInProvisionedMember(member, `catalog.connected.${index}`, password);
    await member.getByRole("button", { name: "Finish setup" }).click();
    await member.goto(index === 0 ? "/" : "/settings/goals");
    return member;
  }));
  const clients = [page, ...members];
  async function expectSuccess(message: string, provider: string) {
    for (const client of clients) {
      await expect(toast(client)).toHaveText(message, { timeout: 15000 });
      const result = await (await client.request.get("/catalog-notifications")).json() as { outcomes: { provider: string; phase: string }[] };
      expect(result.outcomes.some(outcome => outcome.provider === provider && outcome.phase === "succeeded")).toBe(true);
    }
    await toast(page).getByRole("button", { name: "Dismiss notification" }).click();
    // One client's dismissal cannot consume another client's event.
    for (const member of members) {
      await expect(toast(member)).toHaveText(message);
      await toast(member).getByRole("button", { name: "Dismiss notification" }).click();
    }
    for (const client of clients) {
      await client.reload();
      await expect(toast(client)).toHaveCount(0);
    }
  }
  const archive = await basicFoodsArchive(75_000);
  await page.goto("/settings/goals");
  const importing = commandImport("usda-fdc", "foundation-browser.zip", archive);
  await importing;
  await expectSuccess("USDA Foundation catalog installed.", "usda-fdc");
  await page.goto("/settings/catalogs");
  await expect(page.getByText("52 foods installed", { exact: true })).toBeVisible();
  await expect(page.locator('input[type="file"], progress')).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Install|Replace|Retry/ })).toHaveCount(0);
  await commandImport("usda-fdc", "foundation-browser-reimport.zip", archive);
  await expectSuccess("USDA Foundation catalog updated.", "usda-fdc");
  await expect(page.getByText("Archive: foundation-browser-reimport.zip", { exact: true })).toBeVisible();
  const notifications = toast(page);


  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("food-catalogs-mobile.png"), fullPage: true });

  await commandImport("usda-fdc", "foundation-browser-update.zip", archive);
  for (const client of clients) await expect(toast(client)).toHaveText("USDA Foundation catalog updated.");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const visibleToast = notifications.locator('[data-phase="succeeded"]');
  await expect(visibleToast).toHaveCSS("background-color", "rgb(31, 43, 27)");
  expect((await visibleToast.boundingBox())!.y).toBeLessThan(30);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("catalog-notifications-mobile.png") });
  await expect(notifications).toHaveCount(0, { timeout: 8000 });
  // Poll and reconnect repeatedly against the actual durable outcomes.
  for (let poll = 0; poll < 3; poll++) {
    const response = await page.waitForResponse(response => response.url().endsWith("/catalog-notifications") && response.request().method() === "GET");
    expect(response.status()).toBe(200);
    expect((await response.json() as { outcomes: unknown[] }).outcomes).toHaveLength(3);
  }
  await page.context().setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(notifications).toHaveCount(0);
  const reconnected = page.waitForResponse(response => response.url().endsWith("/catalog-notifications") && response.status() === 200);
  await page.context().setOffline(false);
  await reconnected;
  await expect(notifications).toHaveCount(0);
  await commandImport("usda-fdc", "corrupt.zip", Buffer.from("not a zip"), false);
  await page.goto("/settings/goals");
  await expect(notifications).toHaveText("USDA Foundation import failed. Inspect the terminal and retry the command.");
  await expect(notifications.locator('[data-phase="failed"]')).toHaveCSS("background-color", "rgb(55, 30, 27)");
  await notifications.getByRole("button", { name: "Dismiss notification" }).click();
  for (const member of members) {
    const response = await (await member.request.get("/catalog-notifications")).text();
    expect(response).not.toMatch(/corrupt.zip|failed|interrupted|error|filename|csrfToken/);
  }
  await page.goto("/settings/catalogs");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("52 foods installed", { exact: true })).toBeVisible();
  await expect(page.getByText("Archive: foundation-browser-update.zip", { exact: true })).toBeVisible();
  await expect(page.getByText(/records processed|foods imported|records rejected|installation failed/)).toHaveCount(0);
  await expect(page.locator('section[aria-labelledby="open-food-facts-heading"]')).toContainText("○ Not configured");
  await expect(page.getByText(/Check OFF updates|Official OFF downloads|OFF export/)).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("food-catalogs-final-mobile.png"), fullPage: true });
  for (const context of memberContexts) await context.close();

  const context = await browser.newContext({ baseURL: new URL(page.url()).origin, ignoreHTTPSErrors: true });
  try {
    const member = await context.newPage();
    await signInProvisionedMember(member, "catalog.browser.member", password);
    await member.getByRole("button", { name: "Finish setup" }).click();
    await expect(member).toHaveURL("/");
    expect((await context.request.get("/catalog-notifications")).status()).toBe(200);
    expect((await context.request.post("/catalog-notifications", { headers: { Origin: new URL(page.url()).origin }, form: { provider: "usda-fdc", jobId: "denied", completedAt: "denied", csrfToken: "denied" } })).status()).toBe(404);
    expect((await member.goto("/settings/catalogs"))?.status()).toBe(404);
    const denied = await context.request.post("/settings/catalogs", { headers: { Origin: new URL(page.url()).origin, "Content-Type": "application/zip", "X-Archive-Name": "denied.zip" }, data: archive });
    expect(denied.status()).toBe(404);
    await member.goto("/?food=search&query=broccoli&filter=packaged&unknown=ignored");
    await expect(member.getByText("Broccoli crunch", { exact: true })).toHaveCount(0);
    await expect(member.getByText("Broccoli, raw", { exact: true }).first()).toBeVisible();
    await expect(member.getByRole("navigation", { name: "Food type filter" })).toHaveCount(0);
    await member.getByRole("link", { name: /Broccoli, raw.*2019-12-16/ }).click();
    await expect(member.getByRole("heading", { name: "Broccoli, raw", exact: true })).toBeVisible();
    await member.getByLabel("Measurement").selectOption("portion:187633");
    await member.getByLabel("Quantity", { exact: true }).fill("2");
    await member.getByRole("button", { name: /Add to Food Log/ }).click();
    await expect(member).toHaveURL("/?date=2026-08-29");
    await expect(member.getByText("Broccoli, raw", { exact: true })).toBeVisible();
    await member.reload();
    await expect(member.getByText("Broccoli, raw", { exact: true })).toBeVisible();
    configureBarcodeContact();
    await installSimulatedBarcodeCamera(member);
    await member.goto("/?food=barcode");
    await member.getByRole("button", { name: "Use camera" }).click();
    await member.evaluate(() => {
      const state = (window as typeof window & { __scannerState: { barcode: string; emit: boolean } }).__scannerState;
      state.barcode = "0012345678905"; state.emit = true;
    });
    await expect(member.getByRole("heading", { name: "Local oat drink" })).toBeVisible();
    const productMeasurement = member.getByRole("combobox", { name: /Measurement/ });
    await expect(productMeasurement).toHaveValue("ml");
    await productMeasurement.selectOption("100ml");
    await member.getByLabel("Quantity", { exact: true }).fill("2.5");
    await expect(member.getByText("1,000 kcal", { exact: true })).toBeVisible();
    await member.getByRole("button", { name: "Add to Food Log", exact: true }).click();
    const dailyLog = member.getByRole("region", { name: "Daily log entries", exact: true });
    await expect(dailyLog.getByText("Local oat drink", { exact: true })).toBeVisible();
    await member.reload();
    await expect(dailyLog.getByText("Local oat drink", { exact: true })).toBeVisible();
    await member.goto("/?food=barcode&barcode=0012345678906");
    await expect(member.getByRole("alert")).toContainText("Product not found");
    await expect(member.getByRole("button", { name: "Add to Food Log", exact: true })).toHaveCount(0);
    await member.goto("/?food=barcode&barcode=9999999999999");
    await expect(member.getByText("Product not found", { exact: true })).toBeVisible();
    const deniedContact = await context.request.post("/settings/catalogs", { headers: { Origin: new URL(page.url()).origin }, form: { intent: "remove-off-contact", csrfToken: "denied" } });
    expect(deniedContact.status()).toBe(404);

    for (const [query, expected] of [
      ["tilapia", /Fish, tilapia,/], ["eggs", /Eggs,/], ["HUÉVOS", /Eggs,/],
      ["hue", /Eggs,/], ["BROCC", /Broccoli,/], ["brócoli", /Broccoli,/],
      ["carrots", /Carrots,/], ["spinach", /Spinach/],
    ] as const) {
      await member.goto(`/?food=search&query=${encodeURIComponent(query)}`);
      await expect(member.locator('[aria-label="Food search results"]').getByRole("link").first()).toContainText(expected);
    }
    await member.goto("/?food=search&query=broccoli");
    await expect(member.getByRole("link", { name: /Broccoli, frozen, chopped, unprepared/ })).toBeVisible();
    await member.goto("/?food=search&query=huevos");
    const results = member.locator('[aria-label="Food search results"]');
    await expect(results.getByText("Eggplant, raw", { exact: true })).toHaveCount(0);
    await expect(results.getByText("Eggs, whole, raw", { exact: true }).first()).toBeVisible();
    await expect(results.locator('[aria-disabled="true"]')).toContainText("Calories unavailable");
    await results.getByRole("link", { name: /Eggs, whole, cooked, scrambled/ }).click();
    await expect(member.getByRole("heading", { name: "Eggs, whole, cooked, scrambled", exact: true })).toBeVisible();
    await member.getByLabel("Measurement").selectOption("100g");
    await member.getByLabel("Quantity", { exact: true }).fill("1.5");
    await member.getByRole("button", { name: /Add to Food Log/ }).click();
    await expect(member).toHaveURL("/?date=2026-08-29");
    await expect(member.getByText("Eggs, whole, cooked, scrambled", { exact: true })).toBeVisible();
  } finally { await context.close(); }
});


async function unusedPort() {
  const listener = createServer();
  await new Promise<void>(resolve => listener.listen(0, "127.0.0.1", resolve));
  const address = listener.address();
  if (!address || typeof address === "string") throw new Error("Missing test port");
  await new Promise<void>((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));
  return String(address.port);
}

test("a real backend restart delivers independent interruption toasts only to administrators", async ({ browser }) => {
  const directory = await mkdtemp(path.resolve("data/playwright-tests/restart-"));
  const publicPort = await unusedPort();
  const lanPort = await unusedPort();
  const origin = `http://127.0.0.1:${lanPort}`;
  const key = path.join(directory, "key.pem");
  const cert = path.join(directory, "cert.pem");
  await promisify(execFile)("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=localhost", "-keyout", key, "-out", cert]);
  const environment = {
    ...process.env, NODE_ENV: "test", CATALOG_BUILT_WORKER: "1", FOOD_CATALOG_TEST_FIXTURE: "0",
    SETUP_TEST_NOW: "2026-01-01T09:30:00.000Z", FOOD_LOG_TEST_NOW: "2026-08-29T18:00:00.000Z",
    DATABASE_PATH: path.join(directory, "application.sqlite"), CATALOG_DIRECTORY: path.join(directory, "catalogs"), APPLICATION_SECRETS_PATH: path.join(directory, "secrets"),
    APPLICATION_URL: `https://localhost:${publicPort}`, LAN_URL: origin, LAN_PORT: lanPort,
  };
  const start = () => spawn(process.execPath, ["--import", "./tests/browser/off-api-fixture.mjs", "server/playwright-https.js", key, cert, publicPort, lanPort], { env: environment, stdio: "ignore" });
  let backend = start();
  const adminContext = await browser.newContext({ baseURL: origin });
  const memberContext = await browser.newContext({ baseURL: origin });
  try {
    await expect.poll(async () => adminContext.request.get("/health/live").then(response => response.status(), () => 0)).toBe(200);
    const admin = await adminContext.newPage();
    await bootstrapOrSignInBrowserTestUser(admin, "restart.admin", password);
    await admin.getByRole("button", { name: "Finish setup" }).click();
    const member = await memberContext.newPage();
    // Provision through the application's administrator flow on this independent database.
    await admin.goto("/settings/users");
    await admin.getByLabel("Username").fill("restart.member");
    await admin.getByLabel(/^Initial password/).fill(password);
    await admin.getByLabel("Confirm initial password", { exact: true }).fill(password);
    await admin.getByRole("button", { name: /Create member/ }).click();
    await member.goto("/login");
    await submitPasswordLogin(member, "restart.member", password);
    await member.getByLabel("Current password", { exact: true }).fill(password);
    await member.getByLabel("New password", { exact: true }).fill("private replacement horse battery");
    await member.getByLabel("Confirm new password", { exact: true }).fill("private replacement horse battery");
    await member.getByRole("button", { name: "Set password and continue" }).click();
    await member.getByRole("button", { name: "Finish setup" }).click();
    await admin.goto("/settings/goals");
    {
      const provider = "usda-fdc";
      const archive = await basicFoodsArchive(750000);
      const archivePath = path.join(directory, "interrupted.zip");
      await writeFile(archivePath, archive);
      const token = (await readFile(path.join(directory, "catalogs/.local-import-token"), "utf8")).trim();
      let notifyActive!: () => void;
      const active = new Promise<void>(resolve => { notifyActive = resolve; });
      const command = runCatalogImportCommand([provider, archivePath], {
        baseUrl: origin, controlToken: token, pollIntervalMs: 1,
        writeStandardOutput: () => undefined, writeStandardError: () => undefined,
        fetch: async (input, options) => {
          const response = await fetch(input, options);
          if (String(input).includes(`/internal/catalog-imports/${provider}/`)) {
            const status = await response.clone().json() as { job: { phase: string } | null; outcome: unknown };
            if (status.job && !status.outcome) notifyActive();
          }
          return response;
        },
      });
      await Promise.race([active, command.then(() => { throw new Error("Command ended before active import was observed"); })]);
      const stopped = once(backend, "exit");
      backend.kill("SIGTERM");
      await stopped;
      expect(await command).toBe(1);
      backend = start();
      await expect.poll(async () => adminContext.request.get("/health/live").then(response => response.status(), () => 0)).toBe(200);
      await admin.reload();
      await member.reload();
      await expect(toast(admin)).toHaveText("USDA Foundation import interrupted. Inspect the terminal and retry the command.");
      await expect(toast(member)).toHaveCount(0);
      const response = await (await member.request.get("/catalog-notifications")).text();
      expect(response).not.toMatch(/interrupted|failed|filename|error|csrfToken/);
      await toast(admin).getByRole("button", { name: "Dismiss notification" }).click();
    }
  } finally {
    const stopped = once(backend, "exit");
    backend.kill("SIGTERM");
    await stopped;
    await adminContext.close(); await memberContext.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("native serving nutrition from the Open Food Facts API is scannable and saves source-backed totals", async ({ page }) => {
  configureBarcodeContact();
  await bootstrapOrSignInBrowserTestUser(page, "native.serving.admin", password);
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL("/");
  await installSimulatedBarcodeCamera(page);
  await page.goto("/?food=barcode");
  await page.getByRole("button", { name: "Use camera" }).click();
  await page.evaluate(() => {
    const state = (window as typeof window & { __scannerState: { barcode: string; emit: boolean } }).__scannerState;
    state.barcode = "643843715887"; state.emit = true;
  });
  await expect(page.getByRole("heading", { name: "100% Whey Protein Powder", exact: true })).toBeVisible();
  await expect(page.getByText("Barcode 0643843715887")).toBeVisible();
  await expect(page.getByRole("combobox", { name: /Measurement/ })).toHaveValue("serving");
  await expect(page.getByText("150 kcal", { exact: true })).toBeVisible();
  await expect(page.getByText("30 g", { exact: true })).toBeVisible();
  await page.getByLabel("Quantity", { exact: true }).fill("2");
  await expect(page.getByText("300 kcal", { exact: true })).toBeVisible();
  await expect(page.getByText("60 g", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Add to Food Log", exact: true }).click();
  await expect(page).toHaveURL("/?date=2026-08-29");
  await page.reload();
  const log = page.getByRole("region", { name: "Daily log entries", exact: true });
  await expect(log.getByText("100% Whey Protein Powder", { exact: true })).toBeVisible();
  await expect(log.getByText("300 kcal", { exact: true })).toBeVisible();
  await log.getByText("100% Whey Protein Powder", { exact: true }).click();
  await expect(page.getByLabel("Protein (g)")).toHaveValue("60");
  await page.goto("/?food=barcode&barcode=0012345678906");
  await expect(page.getByRole("alert")).toContainText("Product not found");
  await expect(page.getByRole("button", { name: "Add to Food Log", exact: true })).toHaveCount(0);
});
