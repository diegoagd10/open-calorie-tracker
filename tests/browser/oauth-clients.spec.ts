import { createHash } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";
import { bootstrapOrSignInBrowserTestUser, expect, test } from "./reset-database";

test("registration confirms the Client ID and leads back to the saved client list", async ({ page }, testInfo) => {
  await bootstrapOrSignInBrowserTestUser(page, "oauth.clients.browser", "correct horse 🔐 battery");
  await page.getByLabel("Time zone").fill("America/New_York");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/settings/oauth-clients");

  await expect(page.getByRole("heading", { name: "Registered clients" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Read the integration guide (new tab)" })).toHaveAttribute("href", "https://diegoagd10.github.io/open-calory-tracker-docs/");
  await expect(page.getByLabel("Client name")).toHaveCount(0);
  await page.getByRole("link", { name: "Register client" }).click();
  await expect(page.getByRole("heading", { name: "Register a client" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Read the integration guide (new tab)" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("oauth-registration-form-dark.png"), fullPage: true });
  await page.getByLabel("Client name").fill("My terminal");
  await page.getByLabel("Allowed redirect URIs, one per line").fill("http://127.0.0.1:4567/callback");
  await page.getByRole("button", { name: "Register client" }).click();

  await expect(page.getByRole("heading", { name: "Client registered" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("My terminal was saved");
  await expect(page.getByLabel("Client name")).toHaveCount(0);
  const clientId = await page.locator("code").first().textContent();
  expect(clientId).toMatch(/^[A-Za-z0-9_-]{32}$/u);
  await expect(page.getByRole("link", { name: "View registered clients" })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("oauth-registration-confirmation-dark.png"), fullPage: true });

  await page.getByRole("link", { name: "View registered clients" }).click();
  await expect(page.getByRole("heading", { name: "OAuth clients" })).toBeVisible();
  await expect(page.getByText(clientId ?? "", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText(clientId ?? "", { exact: true })).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath("oauth-client-list-mobile-dark.png"), fullPage: true });

  await page.goto("/settings/goals");
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.goto("/settings/oauth-clients");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("oauth-client-list-mobile-light.png"), fullPage: true });
});

test("confidential registration shows the secret on confirmation only", async ({ page }) => {
  await bootstrapOrSignInBrowserTestUser(page, "oauth.secret.browser", "correct horse 🔐 battery");
  await page.getByLabel("Time zone").fill("America/New_York");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/settings/oauth-clients?view=new");
  await page.getByLabel("Client type").selectOption("confidential");
  await page.getByLabel("Client name").fill("Server reader");
  await page.getByLabel("Allowed redirect URIs, one per line").fill("https://reader.example/callback");
  await page.getByRole("button", { name: "Register client" }).click();

  await expect(page.getByRole("heading", { name: "Client registered" })).toBeVisible();
  const secret = await page.locator("code").nth(1).textContent();
  expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/u);
  await expect(page.getByText("Copy this secret now. It will not be shown again.")).toBeVisible();
  await page.getByRole("link", { name: "View registered clients" }).click();
  await expect(page.getByText("Server reader")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(secret ?? "");
});

test("consent shows a selectable permission and distinct allow and decline actions", async ({ page }, testInfo) => {
  await bootstrapOrSignInBrowserTestUser(page, "oauth.consent.browser", "correct horse 🔐 battery");
  await page.getByLabel("Time zone").fill("America/New_York");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL("/");

  await page.goto("/settings/oauth-clients?view=new");
  await page.getByLabel("Client name").fill("Daily Log Reader");
  await page.getByLabel("Allowed redirect URIs, one per line").fill("http://127.0.0.1:4567/callback");
  await page.getByRole("button", { name: "Register client" }).click();
  await expect(page.getByRole("heading", { name: "Client registered" })).toBeVisible();
  const clientId = await page.locator("code").first().textContent();
  if (!clientId) throw new Error("Registration did not show a Client ID");

  const challenge = createHash("sha256").update("a".repeat(43), "ascii").digest("base64url");
  const parameters = new URLSearchParams({
    response_type: "code", client_id: clientId, redirect_uri: "http://127.0.0.1:4567/callback",
    scope: "daily-log:read", code_challenge: challenge, code_challenge_method: "S256",
    state: "browser-consent-state-0123456789",
  });
  const authorizationUrl = `/oauth/authorize?${parameters}`;
  await page.route("http://127.0.0.1:4567/callback**", route => route.fulfill({
    status: 200, contentType: "text/html", body: "<h1>Returned to the client</h1>",
  }));

  await page.setViewportSize({ width: 985, height: 908 });
  await page.goto(authorizationUrl);
  await expect(page.getByRole("heading", { name: "Daily Log Reader wants access to your Food Log" })).toBeVisible();
  const permission = page.getByRole("checkbox", { name: /Read your daily Food Log/u });
  await expect(permission).not.toBeChecked();
  await expect(page.getByRole("button", { name: "Decline" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Allow access" })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("oauth-consent-desktop-dark.png"), fullPage: true });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("oauth-consent-mobile-dark.png"), fullPage: true });
  await page.setViewportSize({ width: 985, height: 908 });
  await page.getByRole("button", { name: "Allow access" }).click();
  await expect(page).toHaveURL(new RegExp("/oauth/authorize\\?", "u"));
  await expect(permission).not.toBeChecked();
  await page.getByRole("button", { name: "Decline" }).click();
  await expect(page).toHaveURL(/error=access_denied/u);

  await page.goto("/settings/goals");
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(authorizationUrl);
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("oauth-consent-mobile-light.png"), fullPage: true });
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.setViewportSize({ width: 985, height: 908 });
  await page.screenshot({ path: testInfo.outputPath("oauth-consent-desktop-light.png"), fullPage: true });
  await permission.check();
  await page.getByRole("button", { name: "Allow access" }).click();
  await expect(page).toHaveURL(/code=/u);
  await expect(page.getByRole("heading", { name: "Returned to the client" })).toBeVisible();
});
