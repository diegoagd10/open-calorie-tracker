import { mkdir, rm, writeFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { bootstrapOrSignInBrowserTestUser, expect, signInProvisionedMember, test } from "./reset-database";

const password = "correct horse 🔐 battery";
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
  await expect(page.getByLabel("Sign-in code")).toHaveText("TEST-1234");
  await expect(page.getByRole("link", { name: "Continue to OpenAI" })).toHaveAttribute("href", "https://auth.openai.com/codex/device");
  await expect(page.getByRole("button", { name: "Connect OpenAI", exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page.getByLabel("Sign-in code")).toHaveText("TEST-1234");
  await page.screenshot({ path: testInfo.outputPath("ai-device-sign-in.png"), fullPage: true });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await writeFile("data/playwright-tests/pi/decision", "approve");
  await expect(page.getByRole("button", { name: "Reconnect OpenAI" })).toBeVisible({ timeout: 10000 });
  await expect(page.getByLabel("Sign-in code")).toHaveCount(0);
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
  await expect(page.getByLabel("Sign-in code")).toBeVisible();
  await page.getByRole("button", { name: "Cancel sign-in" }).click();
  await expect(page.getByLabel("Sign-in code")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Connect OpenAI", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Connect OpenAI", exact: true }).click();
  await expect(page.getByLabel("Sign-in code")).toBeVisible();
  await writeFile("data/playwright-tests/pi/decision", "reject");
  await expect(page.getByRole("alert")).toContainText("Could not connect to OpenAI", { timeout: 10000 });
  await expect(page.getByLabel("Sign-in code")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("synthetic-private-error");
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
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
