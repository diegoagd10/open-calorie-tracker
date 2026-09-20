import AxeBuilder from "@axe-core/playwright";
import { bootstrapOrSignInBrowserTestUser, expect, openBrowserTestDatabase, signInProvisionedMember, test } from "./reset-database";

const password = "correct horse 🔐 battery";
const validPair = {
  gemini: "AIzaSyBrowserGeminiCredential_1234567890",
  typeSafe: "ts_live_BrowserTypeSafeCredential_1234567890",
};

test.beforeEach(async () => {
  const database = openBrowserTestDatabase();
  database.prepare("DELETE FROM encrypted_credential_bundles").run();
  database.prepare("DELETE FROM application_metadata WHERE key = 'photo_analysis_configuration'").run();
  database.close();
});

test("administrator configures credentials, searches models, and keeps per-model thresholds on mobile @camera-matrix", async ({ page }, testInfo) => {
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

  const models = page.getByRole("region", { name: "Models and confidence" });
  await expect(models).toContainText("Ready");
  await expect(page.getByRole("combobox", { name: "Gemini model" })).toHaveValue("gemini-3.1-flash-lite");
  await expect(page.getByRole("combobox", { name: "Jev model" })).toHaveValue("jev-1.13.0");
  await expect(models).toContainText("un calibrated".replace(" ", ""));
  await expect(page.getByLabel("Category confidence threshold")).toHaveValue("0");
  await expect(page.getByLabel("Product confidence threshold")).toHaveValue("0");

  const geminiModel = page.getByRole("combobox", { name: "Gemini model" });
  await geminiModel.fill("3.5");
  await expect(page.getByRole("option", { name: /Gemini 3.5 Flash/ })).toBeVisible();
  await geminiModel.press("Enter");
  await expect(geminiModel).toHaveValue("gemini-3.5-flash");

  const jevModel = page.getByRole("combobox", { name: "Jev model" });
  await jevModel.fill("1.14");
  await jevModel.press("Enter");
  await expect(jevModel).toHaveValue("jev-1.14.0");
  await expect(models).toContainText("jev-1.14.0 is uncalibrated");
  await page.getByLabel("Category confidence threshold").fill("0.3");
  await page.getByLabel("Product confidence threshold").fill("0.55");
  await page.getByRole("button", { name: "Save model settings" }).click();
  await expect(models.getByRole("status").filter({ hasText: "model settings saved" })).toBeVisible();

  await jevModel.fill("1.13");
  await jevModel.press("Enter");
  await expect(page.getByLabel("Category confidence threshold")).toHaveValue("0");
  await expect(page.getByLabel("Product confidence threshold")).toHaveValue("0");
  await page.getByLabel("Category confidence threshold").fill("0.2");
  await page.getByLabel("Product confidence threshold").fill("0.4");
  await page.getByRole("button", { name: "Save model settings" }).click();
  await expect(models).toContainText("Saved calibration for jev-1.13.0");

  await jevModel.fill("1.14");
  await jevModel.press("Enter");
  await expect(page.getByLabel("Category confidence threshold")).toHaveValue("0.3");
  await expect(page.getByLabel("Product confidence threshold")).toHaveValue("0.55");

  await geminiModel.fill("arbitrary-free-text");
  await expect(page.getByText("Choose a Gemini model from the available options.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save model settings" })).toBeDisabled();

  await page.reload();
  await expect(credentials).toContainText("Configured");
  const unavailableDatabase = openBrowserTestDatabase();
  unavailableDatabase.prepare(`
    INSERT INTO application_metadata (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run("photo_analysis_configuration", JSON.stringify({
    version: 1,
    geminiModel: "gemini-3.5-flash",
    jevModel: "jev-9.9.9",
    profiles: {
      "jev-9.9.9": { categoryConfidenceThreshold: 0.7, productConfidenceThreshold: 0.8, calibrated: true },
    },
  }), "2026-09-19T20:00:00.000Z");
  unavailableDatabase.close();
  await page.reload();
  await expect(models).toContainText("Not ready");
  await expect(models.getByRole("alert")).toContainText("selected Jev model is unavailable");
  await expect(jevModel).toHaveValue("jev-9.9.9");
  await expect(page.getByLabel("Category confidence threshold")).toHaveValue("0.7");
  await expect(page.getByLabel("Product confidence threshold")).toHaveValue("0.8");
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
  await expect(models).toContainText("Save a valid credential pair");

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
