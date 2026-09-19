import { mkdir, rm, writeFile } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";
import { bootstrapOrSignInBrowserTestUser, expect, openBrowserTestDatabase, signInProvisionedMember, test } from "./reset-database";

const password = "correct horse 🔐 battery";
const validPair = {
  gemini: "AIzaSyBrowserGeminiCredential_1234567890",
  typeSafe: "ts_live_BrowserTypeSafeCredential_1234567890",
};

async function callbackAddress(page: import("@playwright/test").Page) {
  const href = await page.getByRole("link", { name: "Authorize with OpenAI" }).getAttribute("href");
  if (!href) throw new Error("Missing OpenAI authorization link");
  const state = new URL(href).searchParams.get("state");
  if (!state) throw new Error("Missing OAuth state");
  return `http://localhost:1455/auth/callback?code=browser-approval&state=${state}`;
}

test.beforeEach(async () => {
  const database = openBrowserTestDatabase();
  database.prepare("DELETE FROM encrypted_credential_bundles").run();
  database.close();
  await mkdir("data/playwright-tests/pi", { recursive: true });
  await rm("data/playwright-tests/pi/auth.json", { force: true });
  await writeFile("data/playwright-tests/pi/decision", "pending");
});

test("administrator configures, replaces, and explicitly deletes credentials on mobile @camera-matrix", async ({ page }, testInfo) => {
  await bootstrapOrSignInBrowserTestUser(page, "ai.admin", password);
  await page.getByRole("button", { name: "Finish setup" }).click();
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("link", { name: /AI photo estimates/ }).click();
  await expect(page).toHaveURL("/settings/ai");
  const credentials = page.getByRole("region", { name: "Photo Analysis credentials" });
  await expect(credentials).toContainText("Not configured");

  await page.getByLabel("Gemini API key").fill(validPair.gemini);
  await page.getByLabel("TypeSafe API key").fill(validPair.typeSafe);
  await page.getByRole("button", { name: "Save credential pair" }).click();
  await expect(credentials).toContainText("Configured");
  await expect(page.getByRole("button", { name: "Replace credential pair" })).toBeVisible();
  await expect(page.getByLabel("Gemini API key")).toHaveValue("");
  await expect(page.getByLabel("TypeSafe API key")).toHaveValue("");
  await expect(page.locator("body")).not.toContainText(validPair.gemini);
  await expect(page.locator("body")).not.toContainText(validPair.typeSafe);

  await page.reload();
  await expect(credentials).toContainText("Configured");
  await expect(page.getByLabel("Gemini API key")).toHaveValue("");
  await expect(page.getByLabel("TypeSafe API key")).toHaveValue("");
  await page.getByLabel("Gemini API key").fill("AIzaSyBrowserReplacement_1234567890");
  await page.getByLabel("TypeSafe API key").fill("ts_live_BrowserReplacement_1234567890");
  await page.getByRole("button", { name: "Replace credential pair" }).click();
  await expect(credentials.getByRole("status")).toContainText("credentials saved");

  await page.getByRole("button", { name: "Delete credential pair" }).click();
  await expect(credentials).toContainText("Configured");
  await page.getByLabel("I understand this disables new Photo Analysis credential consumers.").check();
  await page.getByRole("button", { name: "Delete credential pair" }).click();
  await expect(credentials).toContainText("Not configured");
  await expect(page.getByRole("button", { name: "Delete credential pair" })).toHaveCount(0);

  const piConnection = page.getByRole("region", { name: "OpenAI connection" });
  await expect(piConnection).toContainText("Not connected");
  await page.getByRole("button", { name: "Connect OpenAI", exact: true }).click();
  await expect(page.getByRole("link", { name: "Authorize with OpenAI" })).toBeVisible();
  await writeFile("data/playwright-tests/pi/decision", "approve");
  expect((await page.request.get(await callbackAddress(page))).ok()).toBe(true);
  await expect(page.getByRole("button", { name: "Reconnect OpenAI" })).toBeVisible({ timeout: 10_000 });
  await expect(piConnection).toContainText("Connected");
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(piConnection).toContainText("Not connected");

  await page.screenshot({ path: testInfo.outputPath("photo-credentials.png"), fullPage: true });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("validation is non-disclosing and members cannot open shared credential settings", async ({ page, browser }) => {
  await bootstrapOrSignInBrowserTestUser(page, "ai.validation.admin", password);
  await page.getByRole("button", { name: "Finish setup" }).click();
  await page.goto("/settings/ai");
  const rejectedGemini = "AIzaSy_invalid_BrowserCredential_1234567890";
  await page.getByLabel("Gemini API key").fill(rejectedGemini);
  await page.getByLabel("TypeSafe API key").fill(validPair.typeSafe);
  await page.getByRole("button", { name: "Save credential pair" }).click();
  await expect(page.getByRole("alert")).toContainText("could not be validated");
  await expect(page.getByText("Gemini rejected this key.")).toBeVisible();
  await expect(page.getByLabel("Gemini API key")).toHaveValue("");
  await expect(page.getByLabel("TypeSafe API key")).toHaveValue("");
  await expect(page.locator("body")).not.toContainText(rejectedGemini);
  await expect(page.locator("body")).not.toContainText(validPair.typeSafe);

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
