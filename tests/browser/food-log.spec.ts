import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import BetterSqlite3 from "better-sqlite3";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";

const validPassword = "correct horse 🔐 battery";

async function registerAndSetup(
  page: Page,
  username = "food.log.navigation",
  timeZone = "America/New_York",
) {
  await page.goto("/register");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(validPassword);
  await page.getByLabel("Confirm password").fill(validPassword);
  await page.getByRole("button", { name: "Create private account" }).click();
  await page.getByLabel("Time zone").fill(timeZone);
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL("/");
}

function openBrowserTestDatabase() {
  const directory = path.resolve("data/playwright-tests");
  const databasePath = readdirSync(directory)
    .filter((name) => /^application\..+\.sqlite$/.test(name))
    .map((name) => path.join(directory, name))
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs)[0];
  if (!databasePath) throw new Error("browser test database was not created");
  return new BetterSqlite3(databasePath);
}

test("today, historical navigation, calendar access, travel, and future rejection", async ({
  browser,
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.80" });
  await registerAndSetup(page);

  await expect(
    page.getByRole("heading", { name: "Today's Food Log" }),
  ).toBeVisible();
  await expect(
    page.getByText("Saturday, August 29, 2026", { exact: true }).first(),
  ).toBeVisible();

  for (const viewport of [
    { height: 844, width: 390 },
    { height: 900, width: 800 },
    { height: 900, width: 1_120 },
  ]) {
    await page.setViewportSize(viewport);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    const desktopNavigation = page.getByRole("complementary", {
      name: "Primary navigation",
    });
    const mobileNavigation = page.getByRole("navigation", {
      name: "Primary navigation",
    });
    if (viewport.width < 1_120) {
      await expect(desktopNavigation).toBeHidden();
      await expect(mobileNavigation).toBeVisible();
    } else {
      await expect(desktopNavigation).toBeVisible();
      await expect(mobileNavigation).toBeHidden();
    }
  }
  await page.setViewportSize({ height: 720, width: 1_280 });

  await expect(page.getByRole("link", { name: "Sat 29" })).toHaveAttribute(
    "aria-current",
    "date",
  );

  await page.getByRole("link", { name: "Fri 28" }).click();
  await expect(page).toHaveURL("/?date=2026-08-28");
  await expect(
    page.getByRole("heading", {
      name: "Food Log for Friday, August 28, 2026",
    }),
  ).toBeVisible();
  await expect(page.getByText("No entries for this day")).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Food" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Water" })).toBeVisible();
  const csrfToken = await page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: "Add Food" }) })
    .locator('input[name="csrfToken"]')
    .inputValue();

  await page.getByRole("link", { name: "Open calendar" }).click();
  await expect(
    page.getByRole("heading", { exact: true, name: "History" }),
  ).toBeVisible();
  await expect(page.getByText("August 2026", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Previous month" })).toHaveAttribute(
    "href",
    /calendar=2026-07/,
  );
  await expect(
    page.getByRole("button", { name: "Sunday, August 30" }),
  ).toBeDisabled();

  await page.getByRole("link", { name: "Previous month" }).click();
  await expect(page.getByText("July 2026", { exact: true })).toBeVisible();

  const travelContext = await browser.newContext({
    storageState: await context.storageState(),
    timezoneId: "Pacific/Kiritimati",
  });
  const travelPage = await travelContext.newPage();
  await travelPage.goto("/?date=2026-08-28");
  await expect(
    travelPage.getByText("Friday, August 28, 2026", { exact: true }).first(),
  ).toBeVisible();
  await expect(
    travelPage.getByText("America/New_York", { exact: true }),
  ).toBeVisible();
  expect(
    await travelPage.evaluate(
      () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    ),
  ).toBe("Pacific/Kiritimati");
  await travelContext.close();

  await page.goto("/?date=2026-08-28");

  const futureMutationStatus = await page.evaluate(
    async ({ csrfToken }) => {
      const response = await fetch("/?index", {
        body: new URLSearchParams({
          csrfToken,
          date: "2026-08-31",
          intent: "add-food",
        }),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        method: "POST",
      });
      return response.status;
    },
    { csrfToken },
  );
  expect(futureMutationStatus).toBe(422);

  await page.goto("/?date=2026-08-31");
  await expect(page.getByRole("heading", { name: "Future day" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Add Food" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add Water" })).toHaveCount(0);

  const accessibilityScan = await new AxeBuilder({ page }).analyze();
  expect(accessibilityScan.violations).toEqual([]);
});

test("the full stack resolves UTC boundaries and both DST transitions", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.81" });
  await registerAndSetup(page, "food.log.boundaries");

  async function expectToday(instant: string, expectedDate: string) {
    await page.setExtraHTTPHeaders({ "X-Test-Food-Log-Now": instant });
    await page.goto("/");
    await expect(
      page.getByText(expectedDate, { exact: true }).first(),
    ).toBeVisible();
  }

  await expectToday(
    "2026-03-08T04:59:59.999Z",
    "Saturday, March 7, 2026",
  );
  await expectToday(
    "2026-03-08T05:00:00.000Z",
    "Sunday, March 8, 2026",
  );
  await expectToday(
    "2026-03-08T06:59:59.999Z",
    "Sunday, March 8, 2026",
  );
  await expectToday(
    "2026-03-08T07:00:00.000Z",
    "Sunday, March 8, 2026",
  );
  await expectToday(
    "2026-11-01T05:30:00.000Z",
    "Sunday, November 1, 2026",
  );
  await expectToday(
    "2026-11-01T06:30:00.000Z",
    "Sunday, November 1, 2026",
  );

  const database = openBrowserTestDatabase();
  const updateTimeZone = database.prepare(
    `UPDATE user_preferences
     SET time_zone = ?
     WHERE user_id = (
       SELECT id FROM users WHERE username_normalized = ?
     )`,
  );
  updateTimeZone.run("Pacific/Honolulu", "food.log.boundaries");
  await expectToday(
    "2026-01-01T09:30:00.000Z",
    "Wednesday, December 31, 2025",
  );
  updateTimeZone.run("Pacific/Kiritimati", "food.log.boundaries");
  database.close();
  await expectToday(
    "2026-01-01T09:30:00.000Z",
    "Thursday, January 1, 2026",
  );
});
