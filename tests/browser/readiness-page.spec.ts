import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("a visitor can see that the application is ready", async ({ page }) => {
  await page.goto("/");

  await expect(page).toHaveTitle("Open Calory Tracker · Ready");
  await expect(
    page.getByRole("heading", { level: 1, name: "Open Calory Tracker is ready" }),
  ).toBeVisible();
  await expect(page.getByText("All core systems are operational."))
    .toBeVisible();

  const accessibilityScan = await new AxeBuilder({ page }).analyze();
  expect(accessibilityScan.violations).toEqual([]);
});

test("liveness reports that the HTTP process is running", async ({ request }) => {
  const response = await request.get("/health/live");

  expect(response.status()).toBe(200);
  await expect(response.json()).resolves.toEqual({ status: "live" });
});

test("readiness verifies migrations and writable SQLite storage", async ({
  request,
}) => {
  const response = await request.get("/health/ready");

  expect(response.status()).toBe(200);
  await expect(response.json()).resolves.toEqual({ status: "ready" });
});
