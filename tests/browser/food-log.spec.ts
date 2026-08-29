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

async function expectCatalogResponsive(page: Page) {
  for (const viewport of [
    { height: 844, width: 390 },
    { height: 900, width: 800 },
    { height: 900, width: 1_120 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole("dialog", { name: "Add Food" })).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ height: 720, width: 1_280 });
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
  await expect(
    page.getByRole("link", { name: "Previous month" }),
  ).toHaveAttribute("href", /calendar=2026-07/);
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

  const accessibleNameScan = await new AxeBuilder({ page })
    .withRules(["label-content-name-mismatch"])
    .analyze();
  expect(accessibleNameScan.violations).toEqual([]);
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

  await expectToday("2026-03-08T04:59:59.999Z", "Saturday, March 7, 2026");
  await expectToday("2026-03-08T05:00:00.000Z", "Sunday, March 8, 2026");
  await expectToday("2026-03-08T06:59:59.999Z", "Sunday, March 8, 2026");
  await expectToday("2026-03-08T07:00:00.000Z", "Sunday, March 8, 2026");
  await expectToday("2026-11-01T05:30:00.000Z", "Sunday, November 1, 2026");
  await expectToday("2026-11-01T06:30:00.000Z", "Sunday, November 1, 2026");

  const database = openBrowserTestDatabase();
  const updateTimeZone = database.prepare(
    `UPDATE user_preferences
     SET time_zone = ?
     WHERE user_id = (
       SELECT id FROM users WHERE username_normalized = ?
     )`,
  );
  updateTimeZone.run("Pacific/Honolulu", "food.log.boundaries");
  await expectToday("2026-01-01T09:30:00.000Z", "Wednesday, December 31, 2025");
  updateTimeZone.run("Pacific/Kiritimati", "food.log.boundaries");
  database.close();
  await expectToday("2026-01-01T09:30:00.000Z", "Thursday, January 1, 2026");
});

test("authenticated USDA search and idempotent logging preserve a local Nutrition Snapshot", async ({
  browser,
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.82" });
  await registerAndSetup(page, "catalog.search");

  await page.getByRole("button", { name: "Add Food" }).click();
  await expect(page).toHaveURL(/food=search/);
  await expect(page.getByRole("dialog", { name: "Add Food" })).toBeVisible();
  await expect(page.getByText("Search is deliberate.")).toBeVisible();
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  const closeFoodSearch = page.getByRole("link", {
    name: "Close food search",
  });
  await expect(closeFoodSearch).toBeFocused();
  const providerLink = page.getByRole("link", {
    name: "USDA FoodData Central",
  });
  await providerLink.focus();
  await page.keyboard.press("Tab");
  await expect(closeFoodSearch).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(providerLink).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Add Food" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add Food" })).toBeFocused();
  await expect(page.locator("body")).not.toHaveCSS("overflow", "hidden");

  await page.getByRole("button", { name: "Add Food" }).click();
  await page
    .getByRole("dialog", { name: "Add Food" })
    .locator("..")
    .click({ position: { x: 2, y: 2 } });
  await expect(page.getByRole("dialog", { name: "Add Food" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add Food" })).toBeFocused();

  await page.getByRole("button", { name: "Add Food" }).click();
  await expectCatalogResponsive(page);

  const invalidSearch = await page.goto(
    "/?date=2026-08-29&food=search&query=x",
  );
  expect(invalidSearch?.status()).toBe(400);
  await expect(page.getByRole("alert")).toContainText(
    "Enter a food search from 2 to 100 characters.",
  );
  await expectCatalogResponsive(page);

  await page
    .getByRole("searchbox", { name: "Search United States foods" })
    .fill(" ");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("alert")).toContainText("Search not sent");
  await expect(page.getByRole("alert")).toContainText("trimmed food search");
  await expectCatalogResponsive(page);

  let releaseSearch!: () => void;
  const searchGate = new Promise<void>((resolve) => {
    releaseSearch = resolve;
  });
  await page.route(
    /query=yogurt/,
    async (route) => {
      await searchGate;
      await route.continue();
    },
    { times: 1 },
  );
  await page
    .getByRole("searchbox", { name: "Search United States foods" })
    .fill("yogurt");
  const searchClick = page.getByRole("button", { name: "Search" }).click();
  await expect(
    page.getByRole("status").getByText("Searching USDA FoodData Central"),
  ).toBeVisible();
  await expectCatalogResponsive(page);
  releaseSearch();
  await searchClick;
  await expect(page.getByText("Plain nonfat Greek yogurt")).toBeVisible();
  await expectCatalogResponsive(page);

  await page
    .getByRole("searchbox", { name: "Search United States foods" })
    .fill("none");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("No foods found")).toBeVisible();
  await expect(page.getByText("Plain nonfat Greek yogurt")).toHaveCount(0);
  await expectCatalogResponsive(page);

  for (const [query, status, title, message] of [
    ["configuration", 503, "USDA search is not configured", "not configured"],
    ["credentials", 503, "USDA credentials unavailable", "credentials"],
    ["rate", 429, "USDA rate limit reached", "rate limit reached"],
    ["timeout", 503, "USDA is unavailable", "unavailable right now"],
    ["malformed", 502, "USDA response could not be used", "could not be used"],
  ] as const) {
    const response = await page.goto(
      `/?date=2026-08-29&food=search&query=${query}`,
    );
    expect(response?.status()).toBe(status);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByRole("alert")).toContainText(message);
  }
  await expectCatalogResponsive(page);

  const vanished = await page.goto(
    "/?date=2026-08-29&food=4040&query=vanished",
  );
  expect(vanished?.status()).toBe(409);
  await expect(
    page.getByRole("heading", { name: "Food no longer available" }),
  ).toBeVisible();
  await expectCatalogResponsive(page);

  await page
    .getByRole("searchbox", { name: "Search United States foods" })
    .fill("yogurt");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("Plain nonfat Greek yogurt")).toBeVisible();
  await expect(
    page.getByText("Example Dairy Co. · 1 container · 170 g"),
  ).toBeVisible();
  await expect(page.getByText("Branded", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "USDA FoodData Central" }),
  ).toBeVisible();
  await expectCatalogResponsive(page);

  await page
    .getByRole("searchbox", { name: "Search United States foods" })
    .fill("unsafe");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("link", { name: /Unsafe provider measurement/ }).click();
  await expect(page.getByRole("alert")).toContainText(
    "no safe provider-backed measurement",
  );
  await expectCatalogResponsive(page);

  await page
    .getByRole("searchbox", { name: "Search United States foods" })
    .fill("yogurt");
  await page.getByRole("button", { name: "Search" }).click();

  await page.getByRole("link", { name: /Plain nonfat Greek yogurt/ }).click();
  await expect(page.getByText("Saved as a Nutrition Snapshot")).toBeVisible();
  await expect(page.getByLabel("Measurement")).toHaveValue(
    "serving:g:170000000",
  );
  await expectCatalogResponsive(page);
  await page.getByLabel("Quantity").fill("1.5");
  await expect(page.getByText("150.5 kcal")).toBeVisible();

  const foodForm = page.locator("form").filter({
    has: page.getByRole("button", { name: "Add to Food Log" }),
  });
  const submission = await foodForm.evaluate((form) =>
    Object.fromEntries(new FormData(form as HTMLFormElement).entries()),
  );
  const statuses = await page.evaluate(async (fields) => {
    const body = new URLSearchParams(fields as Record<string, string>);
    const first = await fetch("/?index", {
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    const second = await fetch("/?index", {
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    return [first.status, second.status];
  }, submission);
  expect(statuses).toEqual([200, 200]);

  await page.goto("/?date=2026-08-29");
  await expect(
    page.getByText("Plain nonfat Greek yogurt", { exact: true }),
  ).toHaveCount(1);
  await expect(page.getByText("USDA FoodData Central · Branded")).toBeVisible();
  await expect(page.getByRole("article").getByText("150.5 kcal")).toBeVisible();
  await expect(page.locator("img")).toHaveCount(0);

  const anonymous = await browser.newContext();
  const anonymousPage = await anonymous.newPage();
  await anonymousPage.goto("/?food=search&query=yogurt");
  await expect(anonymousPage).toHaveURL(/\/login$/);
  await anonymous.close();

  const accessibilityScan = await new AxeBuilder({ page }).analyze();
  expect(accessibilityScan.violations).toEqual([]);
});
