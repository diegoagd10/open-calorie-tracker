import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import {
  bootstrapOrSignInBrowserTestUser,
  expect,
  openBrowserTestDatabase,
  test,
} from "./reset-database";

const validPassword = "correct horse 🔐 battery";

async function completeSetupForTestUser(page: Page, username: string) {
  await bootstrapOrSignInBrowserTestUser(page, username, validPassword);
  await page.getByLabel("Time zone").fill("America/New_York");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL("/");
}

/** Logs a 1,500 kcal Food Entry on `date` for `username`, as if it was saved that day. */
function insertPastFoodEntry(username: string, date: string) {
  const database = openBrowserTestDatabase();
  database
    .prepare(
      `INSERT INTO food_entries (
         user_id, food_log_date, local_event_time, provider, provider_food_id,
         source_data_type, original_name, authoritative_base_unit,
         authoritative_base_quantity_microunits, authoritative_nutrition,
         selected_measurement_id, selected_measurement_label,
         selected_measurement_unit, selected_measurement_base_quantity_microunits,
         supported_measurements, quantity_microunits,
         authoritative_energy_milli_kcal, idempotency_key, created_at, updated_at
       )
       SELECT id, ?, '12:00:00', 'usda-fdc', 'past-meal', 'Foundation', 'Past meal', 'g',
              100000000, ?, 'base:g:100000000', '100 g', 'g',
              100000000, '[]', 1000000, 1500000, 'past-meal', ?, ?
       FROM users WHERE username_normalized = ?`,
    )
    .run(
      date,
      JSON.stringify(Object.fromEntries([
        "carbohydrateMilligrams", "energyMilliKcal", "fatMilligrams", "fiberMilligrams",
        "proteinMilligrams", "sodiumMilligrams", "sugarMilligrams",
      ].map((nutrient) => [nutrient, null]))),
      `${date}T16:00:00.000Z`,
      `${date}T16:00:00.000Z`,
      username,
    );
  database.close();
}

test("saving the Daily Goal re-evaluates past days against it", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.95" });
  await completeSetupForTestUser(page, "daily.goal");
  insertPastFoodEntry("daily.goal", "2026-08-20");

  await page.goto("/?date=2026-08-29&calendar=2026-08");
  const pastDay = page.locator('a[href="/?date=2026-08-20"][data-calorie-tone]');
  await expect(pastDay).toHaveAttribute("data-calorie-tone", "within");

  await page.goto("/settings/goals");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Account security/ }),
  ).toHaveAttribute("href", "/settings/security");
  await expect(page.getByLabel("Calories target")).toHaveValue("2050");
  await expect(page.getByLabel("Water target")).toHaveValue("80");
  await expect(page.getByText("fl oz", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Effective date")).toHaveCount(0);
  await expect(page.getByLabel("Metric")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Goal Versions" })).toHaveCount(0);

  await page.getByLabel("Water target").fill("500.001");
  await page.getByRole("button", { name: "Save Daily Goal" }).click();
  await expect(page.getByRole("alert")).toHaveText("Water must be from 0.001 to 500 fl oz.");
  await expect(page.getByLabel("Water target")).toHaveAttribute("aria-invalid", "true");

  await page.getByLabel("Water target").fill("64.5");
  await page.getByLabel("Calories target").fill("1400");
  await page.getByLabel("Protein target").fill("110");
  await page.getByLabel("Carbohydrate target").fill("210");
  await page.getByLabel("Fat target").fill("65");
  await page.getByLabel("Fiber target").fill("30");
  await page.getByLabel("Sugar maximum").fill("45");
  await page.getByLabel("Sodium maximum").fill("2000");
  await page.getByRole("button", { name: "Save Daily Goal" }).click();
  await expect(page).toHaveURL("/settings/goals");
  await expect(page.getByRole("status")).toHaveText("Daily Goal saved. Every day now uses it.");
  await expect(page.getByLabel("Calories target")).toHaveValue("1400");
  await expect(page.getByLabel("Water target")).toHaveValue("64.5");

  await page.goto("/?date=2026-08-29&calendar=2026-08");
  await expect(pastDay).toHaveAttribute("data-calorie-tone", "over");
  for (const date of ["2026-08-20", "2026-01-15", "2026-08-29"]) {
    await page.goto(`/?date=${date}`);
    await expect(page.getByText("/ 1,400 kcal", { exact: true })).toBeVisible();
    await expect(page.getByText("/ 64.5 fl oz", { exact: true })).toBeVisible();
  }

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

test("Daily Goal requests ignore manipulated user IDs", async ({
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
    .filter({ has: page.getByRole("button", { name: "Save Daily Goal" }) })
    .evaluate((form, ownerId) => {
      const input = document.createElement("input");
      input.name = "userId";
      input.value = String(ownerId);
      form.append(input);
    }, owner.id);
  await page.getByLabel("Calories target").fill("1750");
  await page.getByRole("button", { name: "Save Daily Goal" }).click();
  await expect(page.getByRole("status")).toContainText("Daily Goal saved");

  const persistedDatabase = openBrowserTestDatabase();
  const goals = persistedDatabase
    .prepare(
      `SELECT
        u.username_normalized AS username,
        g.calorie_target_milli_kcal AS calories
      FROM users u
      JOIN daily_goals g ON g.user_id = u.id
      WHERE u.username_normalized IN ('goal.owner', 'goal.other')
      ORDER BY u.username_normalized`,
    )
    .all();
  persistedDatabase.close();
  expect(goals).toEqual([
    { calories: 1_750_000, username: "goal.other" },
    { calories: 2_050_000, username: "goal.owner" },
  ]);
});
