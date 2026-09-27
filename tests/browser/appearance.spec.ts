import { bootstrapOrSignInBrowserTestUser, expect, test } from "./reset-database";

test("theme switches on desktop and mobile, survives reload and sign-out", async ({ page }) => {
  await bootstrapOrSignInBrowserTestUser(page, "appearance.browser", "correct horse 🔐 battery");
  await page.getByLabel("Time zone").fill("America/New_York");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/settings/goals");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const theme of ["light", "dark"] as const) {
      await page.getByRole("button", { name: theme === "light" ? "Light" : "Dark", exact: true }).click();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await expect(page.getByRole("button", { name: theme === "light" ? "Light" : "Dark", exact: true })).toHaveAttribute("aria-pressed", "true");
      const documentResponse = await page.request.get("/settings/goals");
      expect(await documentResponse.text()).toContain(`data-theme="${theme}"`);
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      expect(await page.locator("html").evaluate(el => getComputedStyle(el).colorScheme)).toBe(theme);
      await expect(page.locator('meta[name="theme-color"]')).toHaveAttribute("content", theme === "dark" ? "#12110e" : "#f5f1e8");
      await page.goto("/?food=manual");
      await expect(page.getByRole("dialog")).toBeVisible();
      expect(await page.getByRole("dialog").evaluate(el => getComputedStyle(el).backgroundColor)).toBe(theme === "dark" ? "rgb(27, 26, 22)" : "rgb(255, 255, 255)");
      const notFoundResponse = await page.goto("/appearance-qa-not-found");
      expect(notFoundResponse?.status()).toBe(404);
      await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.reload();
      await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
      await page.goto("/settings/goals");
    }
  }
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("button", { name: /Sign out/ }).filter({ visible: true }).click();
  await expect(page).toHaveURL("/login");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
});
