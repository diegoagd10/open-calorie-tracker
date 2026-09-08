import AxeBuilder from "@axe-core/playwright";
import { bootstrapOrSignInBrowserTestUser, expect, signInProvisionedMember, test } from "./reset-database";
import { basicFoodsArchive } from "../support/basic-foods-archive";

const password = "correct horse 🔐 battery";
test("administrator installs USDA from mobile Settings, leaves during import, and a member logs a local food", async ({ page, browser }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await bootstrapOrSignInBrowserTestUser(page, "catalog.browser.admin", password);
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/?food=search&query=broccoli");
  await expect(page.getByText("USDA Foundation is not installed", { exact: true })).toBeVisible();
  await page.goto("/settings/goals");
  await page.getByRole("link", { name: /Food Catalogs/ }).click();
  await expect(page.getByRole("heading", { name: "Food Catalogs", exact: true })).toBeVisible();
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
  await page.reload();
  await expect(page.getByText("USDA installation complete", { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("food-catalogs-mobile.png"), fullPage: true });

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
    await member.getByRole("link", { name: /Broccoli, raw.*2019-12-16/ }).click();
    await expect(member.getByRole("heading", { name: "Broccoli, raw", exact: true })).toBeVisible();
    await member.getByLabel("Measurement").selectOption("portion:187633");
    await member.getByLabel("Quantity", { exact: true }).fill("2");
    await member.getByRole("button", { name: /Add to Food Log/ }).click();
    await expect(member).toHaveURL("/?date=2026-08-29");
    await expect(member.getByText("Broccoli, raw", { exact: true })).toBeVisible();
    await member.reload();
    await expect(member.getByText("Broccoli, raw", { exact: true })).toBeVisible();

    for (const [query, expected] of [
      ["tilapia", /Fish, tilapia,/], ["eggs", /Eggs,/], ["HUÉVOS", /Eggs,/],
      ["hue", /Eggs,/], ["BROCC", /Broccoli,/], ["brócoli", /Broccoli,/],
      ["carrots", /Carrots,/], ["spinach", /Spinach/],
    ] as const) {
      await member.goto(`/?food=search&query=${encodeURIComponent(query)}`);
      await expect(member.locator('[aria-label="USDA search results"]').getByRole("link").first()).toContainText(expected);
    }
    await member.goto("/?food=search&query=broccoli");
    await expect(member.getByRole("link", { name: /Broccoli, frozen, chopped, unprepared/ })).toBeVisible();
    await member.goto("/?food=search&query=huevos");
    const results = member.locator('[aria-label="USDA search results"]');
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
