import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import {
  bootstrapOrSignInBrowserTestUser,
  expect,
  openBrowserTestDatabase,
  test,
} from "./reset-database";

const validPassword = "correct horse 🔐 battery";

async function completeSetupForTestUser(
  page: Page,
  username: string,
  options?: { displayUnits: "metric"; water: string },
) {
  await bootstrapOrSignInBrowserTestUser(page, username, validPassword);
  await page.getByLabel("Time zone").fill("America/New_York");
  if (options) {
    await page.getByLabel("Metric").check();
    await page.getByLabel("Water target").fill(options.water);
  }
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL("/");
}

test("an authenticated user replaces complete effective-dated goals", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.95" });
  await completeSetupForTestUser(page, "effective.goals");

  await page.getByRole("link", { name: "Settings" }).click();
  await expect(page).toHaveURL("/settings/goals");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Account security/ }),
  ).toHaveAttribute("href", "/account/password");
  await expect(page.getByLabel("Calories target")).toHaveValue("2050");
  await expect(page.getByLabel("Water target")).toHaveValue("80");
  await expect(page.getByLabel("Effective date")).toHaveAttribute(
    "min",
    "2026-08-29",
  );
  await page.setViewportSize({ height: 908, width: 365 });
  const effectiveDate = page.getByLabel("Effective date");
  const mobileDateContainment = await effectiveDate.evaluate((input) => {
    const card = input.closest("form");
    if (!(card instanceof HTMLFormElement)) {
      throw new Error("Effective date card was not rendered");
    }
    const style = getComputedStyle(input);
    return {
      maxInlineSize: style.maxInlineSize,
      minInlineSize: style.minInlineSize,
      rightOverflow:
        input.getBoundingClientRect().right - card.getBoundingClientRect().right,
    };
  });
  expect(mobileDateContainment.minInlineSize).toBe("0px");
  expect(mobileDateContainment.maxInlineSize).toBe("100%");
  expect(mobileDateContainment.rightOverflow).toBeLessThanOrEqual(0);
  await page.setViewportSize({ height: 720, width: 1_280 });

  await page.getByLabel("Water target").fill("100");
  await page.getByLabel("Metric").check();
  await expect(page.getByLabel("Water target")).toHaveValue("2957.353");
  await expect(page.getByText("ml", { exact: true })).toBeVisible();
  await page.getByLabel("Water target").fill("2365.882");
  await effectiveDate.fill("2026-08-30");
  await page.getByLabel("Calories target").fill("1900");
  await page.getByLabel("Protein target").fill("110");
  await page.getByLabel("Carbohydrate target").fill("210");
  await page.getByLabel("Fat target").fill("65");
  await page.getByLabel("Fiber target").fill("30");
  await page.getByLabel("Sugar maximum").fill("45");
  await page.getByLabel("Sodium maximum").fill("2000");
  await page.getByRole("button", { name: "Save goal version" }).click();

  await expect(page).toHaveURL("/settings/goals");
  await expect(page.getByRole("status")).toHaveText(
    "Goal Version saved for August 30, 2026.",
  );

  await page.getByLabel("Calories target").fill("1850");
  await page.getByRole("button", { name: "Save goal version" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Goal Version replaced for August 30, 2026.",
  );

  await page.goto("/?date=2026-08-29");
  await expect(page.getByText("/ 2,050 kcal", { exact: true })).toBeVisible();
  await page.goto("/?date=2026-08-30");
  await expect(page.getByText("/ 1,850 kcal", { exact: true })).toBeVisible();

  for (const viewport of [
    { height: 844, width: 390 },
    { height: 900, width: 800 },
    { height: 900, width: 1_120 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("/settings/goals");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }

  const accessibilityScan = await new AxeBuilder({ page }).analyze();
  expect(accessibilityScan.violations).toEqual([]);
});

test("Goal Version requests ignore manipulated user IDs", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.96" });
  await completeSetupForTestUser(page, "goal.owner");
  const database = openBrowserTestDatabase();
  const owner = database
    .prepare("SELECT id FROM users WHERE username_normalized = ?")
    .get("goal.owner") as { id: number };
  database.close();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/login");
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.97" });
  await completeSetupForTestUser(page, "goal.other");
  await page.goto(`/settings/goals?userId=${owner.id}`);
  await expect(page.getByText("goal.owner")).toHaveCount(0);

  await page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "Save goal version" }) })
    .evaluate((form, ownerId) => {
      const input = document.createElement("input");
      input.name = "userId";
      input.value = String(ownerId);
      form.append(input);
    }, owner.id);
  await page.getByLabel("Calories target").fill("1750");
  await page.getByRole("button", { name: "Save goal version" }).click();
  await expect(page.getByRole("status")).toContainText("Goal Version saved");

  const persistedDatabase = openBrowserTestDatabase();
  const goals = persistedDatabase
    .prepare(
      `SELECT
        u.username_normalized AS username,
        g.calorie_target_milli_kcal AS calories
      FROM users u
      LEFT JOIN goal_versions g
        ON g.user_id = u.id AND g.effective_date = '2026-08-29'
      WHERE u.username_normalized IN ('goal.owner', 'goal.other')
      ORDER BY u.username_normalized`,
    )
    .all();
  persistedDatabase.close();
  expect(goals).toEqual([
    { calories: 1_750_000, username: "goal.other" },
    { calories: null, username: "goal.owner" },
  ]);
});

test("saving an unchanged rounded water display preserves canonical storage", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.98" });
  await completeSetupForTestUser(page, "goal.precision", {
    displayUnits: "metric",
    water: "2400",
  });

  await page.goto("/settings/goals");
  await page.getByLabel("US").check();
  await expect(page.getByLabel("Water target")).toHaveValue("81.154");
  await page.getByLabel("Calories target").fill("2000");
  await page.getByRole("button", { name: "Save goal version" }).click();
  await expect(page.getByRole("status")).toContainText("Goal Version saved");

  const database = openBrowserTestDatabase();
  const persisted = database
    .prepare(
      `SELECT g.water_target_microliters AS water
       FROM goal_versions g
       JOIN users u ON u.id = g.user_id
       WHERE u.username_normalized = ? AND g.effective_date = ?`,
    )
    .get("goal.precision", "2026-08-29");
  database.close();
  expect(persisted).toEqual({ water: 2_400_000 });
});
