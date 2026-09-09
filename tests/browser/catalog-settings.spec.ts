import { installSimulatedBarcodeCamera } from "./barcode-camera-fixture";
import AxeBuilder from "@axe-core/playwright";
import { bootstrapOrSignInBrowserTestUser, expect, signInProvisionedMember, test } from "./reset-database";
import { offArchive, offProduct, offWithBasis } from "../support/off-archive";
import { basicFoodsArchive } from "../support/basic-foods-archive";

const password = "correct horse 🔐 battery";
test.setTimeout(120_000);
test("administrator installs USDA from mobile Settings, leaves during import, and a member logs a local food", async ({ page, browser }, testInfo) => {
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
  await expect(usdaCard.getByLabel("Foundation CSV ZIP")).toBeEnabled();
  const archive = await basicFoodsArchive(75_000);
  await page.getByLabel("Foundation CSV ZIP").setInputFiles({ name: "foundation-browser.zip", mimeType: "application/zip", buffer: archive });
  const uploaded = page.waitForResponse(response => response.url().endsWith("/settings/catalogs") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Install USDA Foundation" }).click();
  expect((await uploaded).status()).toBe(202);
  await page.goto("/settings/goals");
  await page.getByRole("link", { name: /Food Catalogs/ }).click();
  await expect(page.getByText("USDA installation complete", { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText(/\d+ foods installed/, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Install USDA Foundation" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Replace or reimport USDA Foundation" })).toBeVisible();
  await page.getByLabel("Foundation CSV ZIP").setInputFiles({ name: "foundation-browser-reimport.zip", mimeType: "application/zip", buffer: archive });
  await page.getByRole("button", { name: "Replace or reimport USDA Foundation" }).click();
  await expect(page.getByText("USDA installation complete", { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Archive: foundation-browser-reimport.zip", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("USDA installation complete", { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("food-catalogs-mobile.png"), fullPage: true });

  const products = offArchive([
    { ...offWithBasis("100ml"), product_name: "Local oat drink" },
    { ...offProduct, code: "0012345678906", product_name: "Ambiguous oats" },
    { ...offWithBasis("100g", "0012345678907"), product_name: "Broccoli crunch", generic_name: "Vegetable chips", brands: "Exact Brand" },
  ]);
  await page.getByLabel("OFF tab-separated CSV GZIP").setInputFiles({ name: "products.csv.gz", mimeType: "application/gzip", buffer: products });
  await page.getByRole("button", { name: "Install Open Food Facts" }).click();
  await expect(page.getByText("Open Food Facts installation complete", { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("3 foods installed", { exact: true })).toBeVisible();
  await expect(page.getByText("52 foods installed", { exact: true })).toBeVisible();
  await expect(page.getByText("3 foods imported · 0 food records rejected", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Replace or reimport Open Food Facts" })).toBeVisible();

  const failingReplacement = offArchive(Array.from({ length: 75_000 }, (_, index) => ({
    ...offWithBasis("100g", String(1_000_000_000_000 + index)),
    product_name: `Replacement cereal ${index}`,
  }))).subarray(0, -8);
  await page.getByLabel("OFF tab-separated CSV GZIP").setInputFiles({ name: "corrupt.csv.gz", mimeType: "application/gzip", buffer: failingReplacement });
  const replacementAccepted = page.waitForResponse(response => response.url().endsWith("/settings/catalogs") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Replace or reimport Open Food Facts" }).click();
  expect((await replacementAccepted).status()).toBe(202);
  const activeOffReplacement = page.getByText(/Importing foods and nutrition|Building search index/);
  await expect(activeOffReplacement).toBeVisible({ timeout: 15000 });
  const lookup = await page.context().newPage();
  await lookup.goto("/?food=barcode&barcode=0012345678905");
  await expect(lookup.getByRole("heading", { name: "Local oat drink", exact: true })).toBeVisible();
  await page.reload();
  await expect(activeOffReplacement).toBeVisible();
  await lookup.goto("/?food=search&query=broccoli&filter=basic");
  await expect(lookup.getByText("Broccoli, raw", { exact: true }).first()).toBeVisible();
  await page.reload();
  await expect(activeOffReplacement).toBeVisible();
  await lookup.close();
  await expect(page.getByText("Open Food Facts installation failed", { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByRole("alert")).toContainText("Corrupt OFF GZIP");
  await expect(page.locator('section[aria-labelledby="open-food-facts-heading"]').getByText(/^[1-9][\d,]* foods imported · \d[\d,]* food records rejected$/)).toBeVisible();
  await expect(page.getByText("3 foods installed", { exact: true })).toBeVisible();
  await expect(page.getByText("52 foods installed", { exact: true })).toBeVisible();
  await expect(page.getByText("Select the archive again to retry. Partial uploads are not resumed.", { exact: true })).toBeVisible();

  await page.getByLabel("OFF tab-separated CSV GZIP").setInputFiles({ name: "products-reimport.csv.gz", mimeType: "application/gzip", buffer: products });
  await page.getByRole("button", { name: "Retry Open Food Facts installation" }).click();
  await expect(page.getByText("Open Food Facts installation complete", { exact: true })).toBeVisible({ timeout: 15000 });
  await expect(page.getByText("Archive: products-reimport.csv.gz", { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("both-catalogs-mobile.png"), fullPage: true });

  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    const member = await context.newPage();
    await signInProvisionedMember(member, "catalog.browser.member", password);
    await member.getByRole("button", { name: "Finish setup" }).click();
    await expect(member).toHaveURL("/");
    expect((await member.goto("/settings/catalogs"))?.status()).toBe(404);
    const denied = await context.request.post("/settings/catalogs", { headers: { Origin: "https://localhost:4173", "Content-Type": "application/zip", "X-Archive-Name": "denied.zip" }, data: archive });
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
    await expect(member.getByText("Local oat drink", { exact: true })).toBeVisible();
    await member.reload();
    await expect(member.getByText("Local oat drink", { exact: true })).toBeVisible();
    await member.goto("/?food=barcode&barcode=0012345678906");
    await expect(member.getByRole("alert")).toContainText("does not establish whether nutrition is per 100 g or 100 ml");
    await expect(member.getByRole("button", { name: "Add to Food Log", exact: true })).toBeDisabled();
    await member.goto("/?food=barcode&barcode=9999999999999");
    await expect(member.getByText("Product not found", { exact: true })).toBeVisible();
    const deniedOff = await context.request.post("/settings/catalogs", { headers: { Origin: "https://localhost:4173", "Content-Type": "application/gzip", "X-Catalog-Provider": "open-food-facts", "X-Archive-Name": "denied.gz" }, data: products });
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
