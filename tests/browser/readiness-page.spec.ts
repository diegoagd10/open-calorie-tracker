import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("a visitor is directed to accessible private account access", async ({
  page,
}) => {
  for (const viewport of [
    { height: 1_000, width: 1_440 },
    { height: 844, width: 390 },
  ]) {
    await page.setViewportSize(viewport);

    for (const path of ["/login", "/register"]) {
      await page.goto(path);
      await expect(
        page.getByRole("heading", {
          level: 1,
          name: "Private account access",
        }),
      ).toBeVisible();
      await expect(page.getByText("No email required")).toBeVisible();

      const accessibilityScan = await new AxeBuilder({ page }).analyze();
      expect(accessibilityScan.violations).toEqual([]);
    }
  }
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
