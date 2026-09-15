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
import { bootstrapOrSignInBrowserTestUser, expect, signInProvisionedMember, test } from "./reset-database";
import { offArchive, offProduct, offWithBasis, offJsonlArchive } from "../support/off-archive";
import { basicFoodsArchive } from "../support/basic-foods-archive";

const password = "correct horse 🔐 battery";
const localEvidencePhoto = {
  name: "local-evidence.png",
  mimeType: "image/png",
  buffer: Buffer.concat([
    Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFElEQVR4nGP4TyJgGNUwqmH4agAAr639H708R/EAAAAASUVORK5CYII=", "base64"),
    Buffer.from("local-usda"),
  ]),
};
test.setTimeout(120_000);
async function commandImport(provider: "usda-fdc" | "open-food-facts", filename: string, archive: Buffer, succeeds = true) {
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
  await page.goto("/?food=search&query=broccoli");
  await expect(page.getByRole("status").filter({ hasText: "Basic foods" })).toContainText("catalog is not installed");
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

  await page.goto("/");
  await page.getByRole("button", { name: "Add Food", exact: true }).click();
  await page.getByLabel("Take photo · AI calories").setInputFiles(localEvidencePhoto);
  const photoEntry = page.getByRole("region", { name: "Daily log entries", exact: true }).getByRole("link", { name: /Photo broccoli plate.*32 kcal/ });
  await expect(photoEntry).toBeVisible({ timeout: 15_000 });
  await photoEntry.click();
  const details = page.getByRole("region", { name: "Photo analysis details" });
  await details.getByText("Components, sources and assumptions", { exact: true }).click();
  await expect(details).toContainText("USDA Foundation · FDC 107");
  await expect(details).toContainText("Installed Foundation fixture omits protein");
  await page.goto("/settings/catalogs");

  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("food-catalogs-mobile.png"), fullPage: true });

  const products = offArchive([
    { ...offWithBasis("100ml"), product_name: "Local oat drink" },
    { ...offProduct, code: "0012345678906", product_name: "Ambiguous oats" },
    { ...offWithBasis("100g", "0012345678907"), product_name: "Broccoli crunch", generic_name: "Vegetable chips", brands: "Exact Brand" },
  ]);
  await commandImport("open-food-facts", "products.csv.gz", products);
  await expectSuccess("Open Food Facts catalog installed.", "open-food-facts");
  await page.reload();
  await commandImport("open-food-facts", "products-update.csv.gz", products);
  for (const client of clients) await expect(toast(client)).toHaveText("Open Food Facts catalog updated.");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  const visibleToast = notifications.locator('[data-phase="succeeded"]');
  await expect(visibleToast).toHaveCSS("background-color", "rgb(237, 249, 240)");
  expect((await visibleToast.boundingBox())!.y).toBeLessThan(30);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("catalog-notifications-mobile.png") });
  await expect(notifications).toHaveCount(0, { timeout: 8000 });
  // Poll and reconnect repeatedly against the actual durable outcomes.
  for (let poll = 0; poll < 3; poll++) {
    const response = await page.waitForResponse(response => response.url().endsWith("/catalog-notifications") && response.request().method() === "GET");
    expect(response.status()).toBe(200);
    expect((await response.json() as { outcomes: unknown[] }).outcomes).toHaveLength(4);
  }
  await page.context().setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(notifications).toHaveCount(0);
  const reconnected = page.waitForResponse(response => response.url().endsWith("/catalog-notifications") && response.status() === 200);
  await page.context().setOffline(false);
  await reconnected;
  await expect(notifications).toHaveCount(0);
  await expect(page.getByText("3 foods installed", { exact: true })).toBeVisible();
  await expect(page.getByText("52 foods installed", { exact: true })).toBeVisible();
  const failingReplacement = offArchive(Array.from({ length: 75_000 }, (_, index) => ({
    ...offWithBasis("100g", String(1_000_000_000_000 + index)), product_name: `Replacement cereal ${index}`,
  }))).subarray(0, -8);
  await commandImport("open-food-facts", "corrupt.csv.gz", failingReplacement, false);
  await page.goto("/settings/goals");
  await expect(notifications).toHaveText("Open Food Facts import failed. Inspect the terminal and retry the command.");
  await expect(notifications.locator('[data-phase="failed"]')).toHaveCSS("background-color", "rgb(255, 241, 238)");
  await notifications.getByRole("button", { name: "Dismiss notification" }).click();
  for (const member of members) {
    await expect(toast(member)).toHaveCount(0);
    const response = await (await member.request.get("/catalog-notifications")).text();
    expect(response).not.toMatch(/corrupt.csv.gz|failed|interrupted|error|filename|csrfToken/);
  }
  await page.goto("/settings/catalogs");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(page.getByText("3 foods installed", { exact: true })).toBeVisible();
  await expect(page.getByText("52 foods installed", { exact: true })).toBeVisible();
  await expect(page.getByText(/records processed|foods imported|records rejected|installation failed/)).toHaveCount(0);
  await commandImport("usda-fdc", "corrupt.zip", Buffer.from("not a zip"), false);
  await expect(notifications).toHaveText("USDA Foundation import failed. Inspect the terminal and retry the command.");
  await notifications.getByRole("button", { name: "Dismiss notification" }).click();
  await commandImport("open-food-facts", "products-reimport.csv.gz", products);
  for (const client of clients) await expect(toast(client)).toHaveText("Open Food Facts catalog updated.");
  for (const client of clients) await toast(client).getByRole("button", { name: "Dismiss notification" }).click();
  await page.reload();
  await expect(page.getByText("Archive: products-reimport.csv.gz", { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("both-catalogs-mobile.png"), fullPage: true });
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
    await member.goto("/?food=search&query=broccoli");
    await expect(member.getByRole("heading", { name: "Basic foods" })).toBeVisible();
    await expect(member.getByRole("heading", { name: "Packaged products" })).toBeVisible();
    await expect(member.getByText("Broccoli crunch", { exact: true })).toBeVisible();
    await member.getByRole("link", { name: "Basic foods", exact: true }).click();
    await expect(member.getByText("Broccoli crunch", { exact: true })).toHaveCount(0);
    await expect(member.getByText("Broccoli, raw", { exact: true }).first()).toBeVisible();
    await member.getByRole("link", { name: "All", exact: true }).click();
    await member.getByRole("link", { name: /Broccoli, raw.*2019-12-16/ }).click();
    await expect(member.getByRole("heading", { name: "Broccoli, raw", exact: true })).toBeVisible();
    await member.getByLabel("Measurement").selectOption("portion:187633");
    await member.getByLabel("Quantity", { exact: true }).fill("2");
    await member.getByRole("button", { name: /Add to Food Log/ }).click();
    await expect(member).toHaveURL("/?date=2026-08-29");
    await expect(member.getByText("Broccoli, raw", { exact: true })).toBeVisible();
    await member.reload();
    await expect(member.getByText("Broccoli, raw", { exact: true })).toBeVisible();
    await installSimulatedBarcodeCamera(member);
    await member.goto("/?food=barcode");
    await member.getByRole("button", { name: "Use camera" }).click();
    await member.evaluate(() => {
      const state = (window as typeof window & { __scannerState: { barcode: string; emit: boolean } }).__scannerState;
      state.barcode = "0012345678905"; state.emit = true;
    });
    await expect(member.getByRole("heading", { name: "Local oat drink" })).toBeVisible();
    await member.goto("/?food=search&query=local%20oat&filter=packaged");
    await expect(member.getByText("Packaged product · Open Food Facts", { exact: true })).toBeVisible();
    await member.getByRole("link", { name: /Local oat drink/ }).click();
    await expect(member).toHaveURL(/provider=open-food-facts/);
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
    const deniedOff = await context.request.post("/settings/catalogs", { headers: { Origin: new URL(page.url()).origin, "Content-Type": "application/gzip", "X-Catalog-Provider": "open-food-facts", "X-Archive-Name": "denied.gz" }, data: products });
    expect(deniedOff.status()).toBe(404);

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


test("administrator checks rolling OFF snapshots independently of terminal imports", async ({ page }) => {
  const fixturePath = "data/playwright-tests/off-metadata.json";
  const requestsPath = "data/playwright-tests/off-metadata-requests.jsonl";
  const original = { "Content-Type": "application/gzip", "Content-Length": "252", "Last-Modified": "Mon, 07 Sep 2026 12:00:00 GMT", ETag: '"snapshot-a"', "x-amz-checksum-type": "FULL_OBJECT", "x-amz-checksum-crc64nvme": "JX7I3P/MX4I=" };
  await rm(requestsPath, { force: true });
  await writeFile(fixturePath, JSON.stringify({ headers: original }));
  try {
    await bootstrapOrSignInBrowserTestUser(page, "off.metadata.admin", password);
    await page.getByRole("button", { name: "Finish setup" }).click();
    await page.goto("/settings/catalogs");
    const off = page.locator('section[aria-labelledby="open-food-facts-heading"]');
    const usda = page.locator('section[aria-labelledby="usda-fdc-heading"]');
    const usdaBefore = await usda.innerText();
    const check = off.getByRole("button", { name: "Check OFF updates again" });
    const checkUpdates = async () => {
      await Promise.all([
        page.waitForResponse(response => new URL(response.url()).pathname === "/settings/catalogs.data" && response.request().method() === "GET" && response.ok()),
        check.click(),
      ]);
      await expect(check).toBeEnabled();
    };
    await checkUpdates();
    await expect(off.getByText("OFF snapshot metadata cannot be compared safely.", { exact: true })).toBeVisible();
    await expect(off.getByText("Installed official snapshot: Unknown", { exact: true })).toBeVisible();
    await expect(off.getByRole("link", { name: /Official OFF downloads/ })).toHaveAttribute("href", "https://world.openfoodfacts.org/data");
    const unknown = offArchive([{ ...offProduct, product_name: "Unidentified snapshot" }]);
    await commandImport("open-food-facts", "unknown.gz", unknown);
    await page.reload();
    await expect(off.getByText("Archive: unknown.gz", { exact: true })).toBeVisible();
    await expect(off.getByText("Installed official snapshot: Unknown", { exact: true })).toBeVisible();
    await commandImport("open-food-facts", "renamed-snapshot.gz", offArchive());
    await page.reload();
    await expect(off.getByText("No change detected in the OFF export.", { exact: true })).toBeVisible();
    await expect(off.getByText("Installed official snapshot: 2026-09-07T12:00:00.000Z", { exact: true })).toBeVisible();
    const installedBefore = await off.getByText(/^Installed: /).innerText();
    for (const [fixture, message] of [
      [{ headers: original }, "No change detected in the OFF export."],
      [{ headers: { ...original, ETag: '"snapshot-b"', "Last-Modified": "Tue, 08 Sep 2026 12:00:00 GMT", "x-amz-checksum-crc64nvme": "1Oju86qC+6I=" } }, "A newer OFF export snapshot is available."],
      [{ headers: { ...original, ETag: "", "x-amz-checksum-crc64nvme": "", "Last-Modified": "" } }, "OFF snapshot metadata cannot be compared safely."],
      [{ status: 503 }, "OFF snapshot metadata is temporarily unavailable."],
    ] as const) {
      await writeFile(fixturePath, JSON.stringify(fixture));
      await checkUpdates();
      await expect(off.getByText(message, { exact: true })).toBeVisible();
      await expect(off.getByText("Archive: renamed-snapshot.gz", { exact: true })).toBeVisible();
      await expect(off.getByText(/^Installed: /)).toHaveText(installedBefore);
      await expect(off.locator('input[type="file"], progress')).toHaveCount(0);
      expect(await usda.innerText()).toBe(usdaBefore);
    }
    const beforeReload = (await readFile(requestsPath, "utf8")).trim().split("\n");
    await page.reload();
    await expect(off.getByText("OFF snapshot metadata is temporarily unavailable.", { exact: true })).toBeVisible();
    expect((await readFile(requestsPath, "utf8")).trim().split("\n")).toEqual(beforeReload);
    expect(beforeReload.map(line => JSON.parse(line) as { method: string; url: string })).toEqual(beforeReload.map(() => ({ method: "HEAD", url: "https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz" })));
  } finally { await rm(fixturePath, { force: true }); }
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
    PHOTO_ANALYSIS_TEST_FIXTURE: "1", SETUP_TEST_NOW: "2026-01-01T09:30:00.000Z", FOOD_LOG_TEST_NOW: "2026-08-29T18:00:00.000Z",
    DATABASE_PATH: path.join(directory, "application.sqlite"), CATALOG_DIRECTORY: path.join(directory, "catalogs"),
    PHOTO_AI_AUTH_PATH: path.join(directory, "pi/auth.json"), APPLICATION_URL: `https://localhost:${publicPort}`, LAN_URL: origin, LAN_PORT: lanPort,
  };
  const start = () => spawn(process.execPath, ["--import", "./tests/browser/pi-oauth-fixture.mjs", "--import", "./tests/browser/off-metadata-fixture.mjs", "server/playwright-https.js", key, cert, publicPort, lanPort], { env: environment, stdio: "ignore" });
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
    await member.getByLabel("Username").fill("restart.member");
    await member.getByLabel("Password", { exact: true }).fill(password);
    await member.getByRole("button", { name: "Sign in" }).click();
    await member.getByLabel("Current password", { exact: true }).fill(password);
    await member.getByLabel("New password", { exact: true }).fill("private replacement horse battery");
    await member.getByLabel("Confirm new password", { exact: true }).fill("private replacement horse battery");
    await member.getByRole("button", { name: "Set password and continue" }).click();
    await member.getByRole("button", { name: "Finish setup" }).click();
    await admin.goto("/settings/goals");
    for (const provider of ["usda-fdc", "open-food-facts"] as const) {
      const archive = provider === "usda-fdc" ? await basicFoodsArchive(750000) : offArchive(Array.from({ length: 150000 }, (_, index) => offWithBasis("100g", String(1000000000000 + index))));
      const archivePath = path.join(directory, provider === "usda-fdc" ? "interrupted.zip" : "interrupted.gz");
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
      await expect(toast(admin)).toHaveText(`${provider === "usda-fdc" ? "USDA Foundation" : "Open Food Facts"} import interrupted. Inspect the terminal and retry the command.`);
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

test("JSONL import makes native serving nutrition scannable and saves source-backed totals", async ({ page }) => {
  await bootstrapOrSignInBrowserTestUser(page, "jsonl.browser.admin", password);
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL("/");
  const target = JSON.parse(await readFile("tests/fixtures/off-native-serving.json", "utf8")) as unknown;
  const products = offJsonlArchive([target, { code: "0012345678906", product_name: "Incomplete JSONL food", nutriments: { "energy-kcal_100g": 100 } }]);
  await page.goto("/settings/catalogs");
  await commandImport("open-food-facts", "products.jsonl.gz", products);
  await page.reload();
  await expect(page.getByText("Archive: products.jsonl.gz", { exact: true })).toBeVisible();
  await installSimulatedBarcodeCamera(page);
  await page.goto("/?food=barcode");
  await page.getByRole("button", { name: "Use camera" }).click();
  await page.evaluate(() => {
    const state = (window as typeof window & { __scannerState: { barcode: string; emit: boolean } }).__scannerState;
    state.barcode = "643843715887"; state.emit = true;
  });
  await expect(page.getByRole("heading", { name: "100% Whey Protein Powder", exact: true })).toBeVisible();
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
