import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import BetterSqlite3 from "better-sqlite3";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const validPassword = "correct horse 🔐 battery";

async function register(page: Page, username: string) {
  await page.goto("/register");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(validPassword);
  await page.getByLabel("Confirm password").fill(validPassword);
  await page.getByRole("button", { name: "Create private account" }).click();
  await expect(page).toHaveURL("/setup");
}

function openBrowserTestDatabase(options: { writable?: boolean } = {}) {
  const directory = path.resolve("data/playwright-tests");
  const databasePath = readdirSync(directory)
    .filter((name) => /^application\..+\.sqlite$/.test(name))
    .map((name) => path.join(directory, name))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0];
  if (!databasePath) throw new Error("browser test database was not created");
  return new BetterSqlite3(databasePath, { readonly: !options.writable });
}

test("a new account must complete the privacy-minimal Food Log setup", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.70" });
  await register(page, "setup.required");

  await expect(page).toHaveURL("/setup");
  await expect(
    page.getByRole("heading", { name: "Set up your Food Log" }),
  ).toBeVisible();
  await expect(page.getByRole("group", { name: "Display units" })).toBeVisible();
  await expect(page.getByLabel("US", { exact: true })).toBeChecked();
  await expect(page.getByLabel("Metric", { exact: true })).not.toBeChecked();
  await expect(page.getByLabel("Time zone")).toBeVisible();

  for (const unnecessaryField of [
    "Name",
    "Email",
    "Age",
    "Sex",
    "Height",
    "Weight",
  ]) {
    await expect(page.getByLabel(unnecessaryField, { exact: true })).toHaveCount(
      0,
    );
  }

  await page.goto("/");
  await expect(page).toHaveURL("/setup");

  const accessibilityScan = await new AxeBuilder({ page }).analyze();
  expect(accessibilityScan.violations).toEqual([]);
});

test("US setup creates fixed-point records on the previous local date at a boundary", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.71" });
  await register(page, "setup.us");
  await page.getByLabel("Time zone").fill("Pacific/Honolulu");

  await page.getByRole("button", { name: "Finish setup" }).click();

  await expect(page).toHaveURL("/");
  await expect(
    page.getByRole("heading", { name: "Today's Food Log" }),
  ).toBeVisible();

  const database = openBrowserTestDatabase();
  const setup = database
    .prepare(
      `SELECT
        p.display_units AS displayUnits,
        p.time_zone AS timeZone,
        g.effective_date AS effectiveDate,
        g.calorie_target_milli_kcal AS calorieTargetMilliKcal,
        g.water_target_microliters AS waterTargetMicroliters,
        g.protein_target_milligrams AS proteinTargetMilligrams,
        g.carbohydrate_target_milligrams AS carbohydrateTargetMilligrams,
        g.fat_target_milligrams AS fatTargetMilligrams,
        g.fiber_target_milligrams AS fiberTargetMilligrams,
        g.sugar_maximum_milligrams AS sugarMaximumMilligrams,
        g.sodium_maximum_milligrams AS sodiumMaximumMilligrams
      FROM users u
      JOIN user_preferences p ON p.user_id = u.id
      JOIN goal_versions g ON g.user_id = u.id
      WHERE u.username_normalized = ?`,
    )
    .get("setup.us");
  database.close();

  expect(setup).toEqual({
    calorieTargetMilliKcal: 2_050_000,
    carbohydrateTargetMilligrams: 230_000,
    displayUnits: "us",
    effectiveDate: "2025-12-31",
    fatTargetMilligrams: 70_000,
    fiberTargetMilligrams: 25_000,
    proteinTargetMilligrams: 120_000,
    sodiumMaximumMilligrams: 2_300,
    sugarMaximumMilligrams: 50_000,
    timeZone: "Pacific/Honolulu",
    waterTargetMicroliters: 2_365_882,
  });
});

test("metric setup converts fractional values on the next side of a local-date boundary", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.72" });
  await register(page, "setup.metric");

  await page.getByLabel("Metric", { exact: true }).check();
  await expect(
    page.getByRole("spinbutton", { name: "Water target ml" }),
  ).toBeVisible();
  await page.getByLabel("Time zone").fill("Pacific/Kiritimati");
  await page.getByLabel("Calories target").fill("1800.125");
  await page.getByLabel("Water target").fill("2500.5");
  await page.getByLabel("Protein target").fill("90.25");
  await page.getByLabel("Carbohydrate target").fill("210.125");
  await page.getByLabel("Fat target").fill("60.5");
  await page.getByLabel("Fiber target").fill("30.75");
  await page.getByLabel("Sugar maximum").fill("45.5");
  await page.getByLabel("Sodium maximum").fill("1900");

  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL("/");

  const database = openBrowserTestDatabase();
  const setup = database
    .prepare(
      `SELECT
        p.display_units AS displayUnits,
        p.time_zone AS timeZone,
        g.effective_date AS effectiveDate,
        g.calorie_target_milli_kcal AS calorieTargetMilliKcal,
        g.water_target_microliters AS waterTargetMicroliters,
        g.protein_target_milligrams AS proteinTargetMilligrams,
        g.carbohydrate_target_milligrams AS carbohydrateTargetMilligrams,
        g.fat_target_milligrams AS fatTargetMilligrams,
        g.fiber_target_milligrams AS fiberTargetMilligrams,
        g.sugar_maximum_milligrams AS sugarMaximumMilligrams,
        g.sodium_maximum_milligrams AS sodiumMaximumMilligrams
      FROM users u
      JOIN user_preferences p ON p.user_id = u.id
      JOIN goal_versions g ON g.user_id = u.id
      WHERE u.username_normalized = ?`,
    )
    .get("setup.metric");
  database.close();

  expect(setup).toEqual({
    calorieTargetMilliKcal: 1_800_125,
    carbohydrateTargetMilligrams: 210_125,
    displayUnits: "metric",
    effectiveDate: "2026-01-01",
    fatTargetMilligrams: 60_500,
    fiberTargetMilligrams: 30_750,
    proteinTargetMilligrams: 90_250,
    sodiumMaximumMilligrams: 1_900,
    sugarMaximumMilligrams: 45_500,
    timeZone: "Pacific/Kiritimati",
    waterTargetMicroliters: 2_500_500,
  });
});

test("bounded validation is accessible and an invalid submission persists nothing", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.73" });
  await register(page, "setup.invalid");

  const manipulatedStatus = await page.evaluate(async () => {
    const response = await fetch("/setup", {
      body: new URLSearchParams({
        calories: "2050",
        carbohydrate: "230",
        csrfToken: "invalid",
        displayUnits: "us",
        fat: "70",
        fiber: "25",
        protein: "120",
        sodium: "2300",
        sugar: "50",
        timeZone: "America/Los_Angeles",
        water: "80",
      }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    return response.status;
  });
  expect(manipulatedStatus).toBe(403);

  await page.getByLabel("Time zone").fill("America/Los_Angeles");
  await page.getByLabel("Water target").fill("500.001");

  await page.getByRole("button", { name: "Finish setup" }).click();

  await expect(page).toHaveURL("/setup");
  await expect(page.getByRole("alert")).toHaveText(
    "Water must be from 0.001 to 500 fl oz.",
  );
  await expect(page.getByLabel("Water target")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await expect(page.getByLabel("Water target")).toHaveValue("500.001");

  const database = openBrowserTestDatabase();
  const persisted = database
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM user_preferences p WHERE p.user_id = u.id) AS preferences,
        (SELECT COUNT(*) FROM goal_versions g WHERE g.user_id = u.id) AS goals
      FROM users u
      WHERE u.username_normalized = ?`,
    )
    .get("setup.invalid");
  database.close();
  expect(persisted).toEqual({ goals: 0, preferences: 0 });

  const accessibilityScan = await new AxeBuilder({ page }).analyze();
  expect(accessibilityScan.violations).toEqual([]);
});

test("a full-stack database failure rolls back the preference and Goal Version", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.76" });
  await register(page, "setup.rollback");
  await page.getByLabel("Time zone").fill("UTC");

  const database = openBrowserTestDatabase({ writable: true });
  const user = database
    .prepare("SELECT id FROM users WHERE username_normalized = ?")
    .get("setup.rollback") as { id: number };
  database.exec(`CREATE TRIGGER fail_goal_version_for_atomic_user
    BEFORE INSERT ON goal_versions
    WHEN NEW.user_id = ${user.id}
    BEGIN
      SELECT RAISE(FAIL, 'forced Goal Version failure');
    END`);
  database.close();

  const failedSave = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes("/setup"),
  );
  await page.getByRole("button", { name: "Finish setup" }).click();
  expect((await failedSave).status()).toBe(500);

  const persistedDatabase = openBrowserTestDatabase({ writable: true });
  const persisted = persistedDatabase
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM user_preferences p WHERE p.user_id = u.id) AS preferences,
        (SELECT COUNT(*) FROM goal_versions g WHERE g.user_id = u.id) AS goals
      FROM users u
      WHERE u.username_normalized = ?`,
    )
    .get("setup.rollback");
  persistedDatabase.exec("DROP TRIGGER fail_goal_version_for_atomic_user");
  persistedDatabase.close();
  expect(persisted).toEqual({ goals: 0, preferences: 0 });
});

test("setup reads and writes remain scoped to the authenticated user", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.74" });
  await register(page, "setup.owner");
  await page.getByLabel("Time zone").fill("UTC");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL("/");

  const database = openBrowserTestDatabase();
  const owner = database
    .prepare("SELECT id FROM users WHERE username_normalized = ?")
    .get("setup.owner") as { id: number };
  database.close();

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/login");
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.75" });
  await register(page, "setup.other");
  await page.goto(`/setup?userId=${owner.id}`);
  await expect(page).toHaveURL(`/setup?userId=${owner.id}`);
  await expect(page.getByText("setup.owner")).toHaveCount(0);
  await page.getByLabel("Time zone").fill("UTC");
  await page.getByLabel("Calories target").fill("1234");
  await page.locator("form").evaluate((form, userId) => {
    const input = document.createElement("input");
    input.name = "userId";
    input.value = String(userId);
    form.append(input);
  }, owner.id);
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL("/");
  await expect(page.getByText("Signed in as setup.other")).toBeVisible();
  await expect(page.getByText("setup.owner")).toHaveCount(0);

  const persistedDatabase = openBrowserTestDatabase();
  const goals = persistedDatabase
    .prepare(
      `SELECT
        u.username_normalized AS username,
        g.calorie_target_milli_kcal AS calories
      FROM users u
      JOIN goal_versions g ON g.user_id = u.id
      WHERE u.username_normalized IN ('setup.owner', 'setup.other')
      ORDER BY u.username_normalized`,
    )
    .all();
  persistedDatabase.close();
  expect(goals).toEqual([
    { calories: 1_234_000, username: "setup.other" },
    { calories: 2_050_000, username: "setup.owner" },
  ]);
});
