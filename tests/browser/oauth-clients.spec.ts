import AxeBuilder from "@axe-core/playwright";
import { bootstrapOrSignInBrowserTestUser, expect, test } from "./reset-database";

test("registration confirms the Client ID and leads back to the saved client list", async ({ page }, testInfo) => {
  await bootstrapOrSignInBrowserTestUser(page, "oauth.clients.browser", "correct horse 🔐 battery");
  await page.getByLabel("Time zone").fill("America/New_York");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/settings/oauth-clients");

  await expect(page.getByRole("heading", { name: "Registered clients" })).toBeVisible();
  await expect(page.getByLabel("Client name")).toHaveCount(0);
  await page.getByRole("link", { name: "Register client" }).click();
  await expect(page.getByRole("heading", { name: "Register a client" })).toBeVisible();
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
