import { mkdir, rm, writeFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { bootstrapOrSignInBrowserTestUser, expect, signInProvisionedMember, test } from "./reset-database";

const password = "correct horse 🔐 battery";
async function callbackAddress(page: import("@playwright/test").Page) {
  const href = await page.getByRole("link", { name: "Authorize with OpenAI" }).getAttribute("href");
  if (!href) throw new Error("Missing OpenAI authorization link");
  const state = new URL(href).searchParams.get("state");
  if (!state) throw new Error("Missing OAuth state");
  return `http://localhost:1455/auth/callback?code=browser-approval&state=${state}`;
}
test.beforeEach(async () => {
  await mkdir("data/playwright-tests/pi", { recursive: true });
  await rm("data/playwright-tests/pi/auth.json", { force: true });
  await writeFile("data/playwright-tests/pi/decision", "pending");
});

test("administrator connects from mobile Settings, survives reload, and disconnects @camera-matrix", async ({ page }, testInfo) => {
  await bootstrapOrSignInBrowserTestUser(page, "ai.admin", password);
  await page.getByRole("button", { name: "Finish setup" }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("link", { name: /AI photo estimates/ }).click();
  await expect(page).toHaveURL("/settings/ai");
  const connection = page.getByRole("region", { name: "OpenAI connection" });
  await expect(connection).toContainText("Not connected");
  await page.getByRole("button", { name: "Connect OpenAI", exact: true }).click();
  await expect(page.getByRole("link", { name: "Authorize with OpenAI" })).toHaveAttribute("href", /^https:\/\/auth\.openai\.com\/oauth\/authorize\?/u);
  await expect(page.getByText("No device-code login setting is required.")).toBeVisible();
  await expect(connection.locator('[name="authorizationResponse"]')).toHaveCount(0);
  await expect(connection.getByRole("button", { name: "Finish authorization" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Connect OpenAI", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("link", { name: "Authorize with OpenAI" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("ai-browser-sign-in.png"), fullPage: true });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await writeFile("data/playwright-tests/pi/decision", "approve");
  expect((await page.request.get(await callbackAddress(page))).ok()).toBe(true);
  await expect(page.getByRole("button", { name: "Reconnect OpenAI" })).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole("link", { name: "Authorize with OpenAI" })).toHaveCount(0);
  await expect(connection).toContainText("Connected");
  await page.reload();
  await expect(page.getByRole("button", { name: "Reconnect OpenAI" })).toBeVisible();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByRole("button", { name: "Connect OpenAI", exact: true })).toBeVisible();
  await expect(connection).toContainText("Not connected");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("administrator cancels, retries, sees provider errors, and members cannot open AI settings", async ({ page, browser }) => {
  await bootstrapOrSignInBrowserTestUser(page, "ai.cancel.admin", password);
  await page.getByRole("button", { name: "Finish setup" }).click();
  await page.goto("/settings/ai");
  await page.getByRole("button", { name: "Connect OpenAI", exact: true }).click();
  await expect(page.getByRole("link", { name: "Authorize with OpenAI" })).toBeVisible();
  await page.getByRole("button", { name: "Cancel sign-in" }).click();
  await expect(page.getByRole("link", { name: "Authorize with OpenAI" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Connect OpenAI", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Connect OpenAI", exact: true }).click();
  await expect(page.getByRole("link", { name: "Authorize with OpenAI" })).toBeVisible();
  await writeFile("data/playwright-tests/pi/decision", "reject");
  expect((await page.request.get(await callbackAddress(page))).ok()).toBe(true);
  await expect(page.getByRole("alert")).toContainText("Could not connect to OpenAI", { timeout: 10000 });
  await expect(page.getByRole("link", { name: "Authorize with OpenAI" })).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("synthetic-private-error");
  const context = await browser.newContext({ baseURL: new URL(page.url()).origin, ignoreHTTPSErrors: true });
  try {
    const member = await context.newPage();
    await signInProvisionedMember(member, "ai.regular.member", password);
    await member.getByRole("button", { name: "Finish setup" }).click();
    await member.goto("/settings/goals");
    await expect(member.getByRole("link", { name: /AI photo estimates/ })).toHaveCount(0);
    expect((await member.goto("/settings/ai"))?.status()).toBe(404);
  } finally {
    await context.close();
  }
});
