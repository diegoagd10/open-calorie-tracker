import AxeBuilder from "@axe-core/playwright";
import { bootstrapOrSignInBrowserTestUser, expect, test } from "./reset-database";

test("an account holder creates a key and copies it without it ever being rendered", async ({ context, page }, testInfo) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await bootstrapOrSignInBrowserTestUser(page, "api.keys.browser", "correct horse 🔐 battery");
  await page.getByLabel("Time zone").fill("America/New_York");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/settings/api-keys");

  await expect(page.getByRole("heading", { name: "API keys" })).toBeVisible();
  await expect(page.getByText("Authorization: Bearer <key>")).toBeVisible();
  const mcpUrl = await page.getByText(/\/mcp$/u).textContent();
  expect(mcpUrl).toMatch(/^https?:\/\/[^/]+\/mcp$/u);
  await page.getByRole("button", { name: "Copy MCP URL" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(mcpUrl);

  await page.getByRole("link", { name: "Create key" }).click();
  await expect(page.getByRole("heading", { name: "Create API key" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "Read Food Log" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Read Food Log" })).toBeDisabled();
  await expect(page.getByLabel("Expiration")).toHaveValue("90d");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("api-key-form-dark.png"), fullPage: true });
  await page.getByLabel("Name").fill("Muse");
  await page.getByRole("button", { name: "Create key" }).click();

  await expect(page).toHaveURL("/settings/api-keys?created=1");
  await expect(page.getByRole("status")).toContainText("API key created");
  const masked = await page.locator("li code").first().textContent();
  expect(masked).toMatch(/^oct_[A-Za-z0-9_-]{4}••••[A-Za-z0-9_-]{4}$/u);
  await page.getByRole("button", { name: "Copy Muse" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Copied" })).toBeVisible();
  const key = await page.evaluate(() => navigator.clipboard.readText());
  expect(key).toMatch(/^oct_[A-Za-z0-9_-]{43}$/u);
  expect(masked).toBe(`${key.slice(0, 8)}••••${key.slice(-4)}`);
  expect(await page.content()).not.toContain(key);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("api-key-list-dark.png"), fullPage: true });

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("api-key-list-mobile-dark.png"), fullPage: true });

  await page.goto("/settings/goals");
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.goto("/settings/api-keys");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("api-key-list-mobile-light.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: testInfo.outputPath("api-key-list-light.png"), fullPage: true });
});
