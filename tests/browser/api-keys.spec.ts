import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { bootstrapOrSignInBrowserTestUser, expect, test } from "./reset-database";

/** Each endpoint's Copy button stays on the URL's last line, just after it, at any width. */
async function expectCopyBesideUrls(page: Page) {
  for (const [label, suffix] of [["Copy MCP URL", /\/mcp$/u], ["Copy API URL", /\/api\/v1\/daily-log$/u]] as const) {
    const url = await page.locator("code").filter({ hasText: suffix }).boundingBox();
    const button = await page.getByRole("button", { name: label }).boundingBox();
    if (!url || !button) throw new Error(`${label} or its URL is not rendered`);
    const buttonMiddle = button.y + button.height / 2;
    expect(buttonMiddle).toBeGreaterThanOrEqual(url.y);
    expect(buttonMiddle).toBeLessThanOrEqual(url.y + url.height + button.height / 2);
    expect(button.x).toBeGreaterThanOrEqual(url.x + url.width - 1);
  }
}

test("an account holder creates, copies, edits, and deletes a key without it ever being rendered", async ({ context, page }, testInfo) => {
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
  await expect(page.getByRole("checkbox", { name: "Read Food Log" })).not.toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Log water" })).not.toBeChecked();
  await expect(page.getByText("coming soon")).toHaveCount(0);
  await expect(page.getByLabel("Expiration")).toHaveValue("90d");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("api-key-form-dark.png"), fullPage: true });
  await page.getByLabel("Name").fill("Muse");
  await page.getByRole("checkbox", { name: "Read Food Log" }).check();
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

  await expectCopyBesideUrls(page);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expectCopyBesideUrls(page);
  await page.screenshot({ path: testInfo.outputPath("api-key-list-mobile-dark.png"), fullPage: true });

  await page.goto("/settings/goals");
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.goto("/settings/api-keys");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("api-key-list-mobile-light.png"), fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: testInfo.outputPath("api-key-list-light.png"), fullPage: true });

  await page.getByRole("link", { name: "Edit Muse" }).click();
  await expect(page.getByRole("heading", { name: "Edit Muse" })).toBeVisible();
  await expect(page.getByLabel("Name")).toHaveValue("Muse");
  await expect(page.getByLabel("Expiration")).toHaveValue("90d");
  await expect(page.getByRole("checkbox", { name: "Read Food Log" })).toBeChecked();
  await expect(page.getByRole("checkbox", { name: "Log water" })).not.toBeChecked();
  await expect(page.getByLabel("Expiration").locator("option")).toHaveText([
    /^1 day · \w{3} \d{1,2}, \d{4}$/u, /^7 days · /u, /^30 days · /u, /^90 days · /u, /^1 year · /u, "No expiration",
  ]);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("api-key-edit-light.png"), fullPage: true });
  await page.getByLabel("Name").fill("Muse phone");
  await page.getByLabel("Expiration").selectOption("never");
  await page.getByRole("checkbox", { name: "Log water" }).check();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL("/settings/api-keys?updated=1");
  await expect(page.getByRole("status")).toContainText("API key updated");
  await expect(page.getByText("Permissions: Read Food Log, Log water")).toBeVisible();
  await expect(page.getByText("No expiration")).toBeVisible();
  await page.getByRole("button", { name: "Copy Muse phone" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Copied" })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(key);

  await page.getByRole("link", { name: "Delete Muse phone" }).click();
  await expect(page.getByRole("heading", { name: "Delete Muse phone?" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("api-key-delete-light.png"), fullPage: true });
  await page.getByRole("button", { name: "Delete key" }).click();
  await expect(page).toHaveURL("/settings/api-keys?deleted=1");
  await expect(page.getByRole("status")).toContainText("API key deleted");
  await expect(page.getByText("No API keys yet.")).toBeVisible();
});
