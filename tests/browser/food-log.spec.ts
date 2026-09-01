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
    .sort(
      (left, right) =>
        statSync(right).birthtimeMs - statSync(left).birthtimeMs,
    )[0];
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

async function expectFoodEntryEditorResponsive(page: Page) {
  for (const viewport of [
    { height: 844, width: 390 },
    { height: 900, width: 800 },
    { height: 900, width: 1_120 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(
      page.getByRole("dialog", { name: "Edit Food Entry" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ height: 720, width: 1_280 });
}

async function expectFoodEntryStatusResponsive(page: Page, message: string) {
  for (const viewport of [
    { height: 844, width: 390 },
    { height: 900, width: 800 },
    { height: 900, width: 1_120 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(page.getByRole("status")).toContainText(message);
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

test("daily calorie and nutrient progress is factual, responsive, and accessible", async ({
  browser,
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.87" });
  await registerAndSetup(page, "nutrition.progress");

  await expect(
    page.getByRole("progressbar", { name: "Calorie progress" }),
  ).toHaveAttribute("aria-valuetext", "0 of 2,050 kcal target");
  await expect(page.getByText("Incomplete", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("article", { name: /Protein: 0 of 120 g target/ }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("article", {
        includeHidden: true,
        name: /Sugar: 0 of 50 g maximum/,
      })
      .locator(".."),
  ).toHaveAttribute("aria-hidden", "true");

  await page.getByRole("button", { name: "Add Food" }).click();
  await page
    .getByRole("searchbox", { name: "Search United States foods" })
    .fill("yogurt");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("link", { name: /Plain nonfat Greek yogurt/ }).click();
  await page.getByRole("button", { name: "Add to Food Log" }).click();
  await expect(
    page
      .getByRole("article")
      .getByText("Plain nonfat Greek yogurt", { exact: true }),
  ).toBeVisible();

  const database = openBrowserTestDatabase();
  const user = database
    .prepare("SELECT id FROM users WHERE username_normalized = ?")
    .get("nutrition.progress") as { id: number };
  const updatedEntries = database
    .prepare(
      `UPDATE food_entries
       SET authoritative_energy_milli_kcal = NULL,
           authoritative_protein_milligrams = 120500,
           authoritative_carbohydrate_milligrams = 230001,
           authoritative_fat_milligrams = 70050,
           authoritative_fiber_milligrams = NULL,
           authoritative_sugar_milligrams = 50001,
           authoritative_sodium_milligrams = 2301
       WHERE user_id = ?`,
    )
    .run(user.id);
  expect(updatedEntries.changes).toBe(1);
  database
    .prepare(
      `INSERT INTO goal_versions (
         user_id, effective_date, calorie_target_milli_kcal,
         water_target_microliters, protein_target_milligrams,
         carbohydrate_target_milligrams, fat_target_milligrams,
         fiber_target_milligrams, sugar_maximum_milligrams,
         sodium_maximum_milligrams, created_at
       ) VALUES (?, '2026-08-29', 1000000, 2000000, 100000, 200000,
                 60000, 20000, 40000, 2000, '2026-08-29T12:00:00.000Z')`,
    )
    .run(user.id);
  database.close();

  await page.goto("/?date=2026-08-29");
  const calorieProgress = page.getByRole("progressbar", {
    name: "Calorie progress",
  });
  await expect(calorieProgress).toHaveAttribute(
    "aria-valuetext",
    "0 known of 1,000 kcal target; incomplete",
  );
  await expect(
    page.getByRole("article", {
      name: "Protein: 120.5 of 100 g target",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("progressbar", { name: "Protein progress" }),
  ).toHaveCSS("--progress", "100%");
  await expect(
    page.getByRole("article", {
      name: "Fat: 70.05 of 60 g target",
    }),
  ).toBeVisible();

  const secondPage = page.getByRole("button", {
    name: "Show fiber, sugar, and sodium",
  });
  await secondPage.focus();
  await page.keyboard.press("Enter");
  await expect(secondPage).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("article", {
      name: "Fiber: 0 known of 20 g target; incomplete",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("article", {
      name: "Sugar: 50.001 of 40 g maximum",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("article", {
      name: "Sodium: 2,301 of 2,000 mg maximum",
    }),
  ).toBeVisible();

  const precisionDatabase = openBrowserTestDatabase();
  precisionDatabase
    .prepare(
      `UPDATE food_entries
       SET authoritative_energy_milli_kcal = 1234
       WHERE user_id = ?`,
    )
    .run(user.id);
  precisionDatabase.close();
  await page.goto("/?date=2026-08-29");
  await expect(
    page.getByRole("region", { name: "Calories" }),
  ).toContainText("1.2 / 1,000 kcal");

  const touchContext = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    storageState: await context.storageState(),
    viewport: { height: 844, width: 390 },
  });
  const touchPage = await touchContext.newPage();
  await touchPage.goto("/?date=2026-08-29");
  const nutrientCarousel = touchPage.getByRole("region", {
    name: "Daily nutrient progress",
  });
  const carouselBox = await nutrientCarousel.boundingBox();
  expect(carouselBox).not.toBeNull();
  const touchClient = await touchContext.newCDPSession(touchPage);
  const swipeY = carouselBox!.y + carouselBox!.height / 2;
  const touchStart = async (x: number) => {
    await touchClient.send("Input.dispatchTouchEvent", {
      touchPoints: [{ x, y: swipeY }],
      type: "touchStart",
    });
  };
  const touchMove = async (x: number) => {
    await touchClient.send("Input.dispatchTouchEvent", {
      touchPoints: [{ x, y: swipeY }],
      type: "touchMove",
    });
  };
  const touchEnd = async () => {
    await touchClient.send("Input.dispatchTouchEvent", {
      touchPoints: [],
      type: "touchEnd",
    });
  };
  const swipeLeftStart = carouselBox!.x + carouselBox!.width * 0.75;
  const swipeLeftEnd = carouselBox!.x + carouselBox!.width * 0.25;
  const fiberPage = touchPage
    .getByRole("article", {
      includeHidden: true,
      name: "Fiber: 0 known of 20 g target; incomplete",
    })
    .locator("..");
  const nutrientTrack = fiberPage.locator("..");
  await touchStart(swipeLeftStart);
  await touchMove(swipeLeftEnd);
  await expect
    .poll(async () => (await fiberPage.boundingBox())?.x)
    .toBeLessThan(carouselBox!.x + carouselBox!.width);
  await expect(nutrientTrack).toHaveCSS("transition-duration", "0s");
  await touchEnd();
  await expect(
    touchPage.getByRole("article", {
      name: "Fiber: 0 known of 20 g target; incomplete",
    }),
  ).toBeVisible();
  await expect(nutrientTrack).toHaveCSS("transition-duration", "0.32s");
  await touchStart(swipeLeftEnd);
  await touchMove(swipeLeftStart);
  await touchEnd();
  await expect(
    touchPage.getByRole("article", {
      name: "Protein: 120.5 of 100 g target",
    }),
  ).toBeVisible();
  await touchPage.emulateMedia({ reducedMotion: "reduce" });
  await touchStart(swipeLeftStart);
  await touchMove(swipeLeftEnd);
  await touchEnd();
  await expect(nutrientTrack).toHaveCSS("transition-duration", "0s");
  await touchContext.close();

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
  }

  await page.goto("/?date=2026-08-28");
  await expect(
    page.getByRole("progressbar", { name: "Calorie progress" }),
  ).toHaveAttribute("aria-valuetext", "0 of 2,050 kcal target");

  const noGoalDatabase = openBrowserTestDatabase();
  noGoalDatabase
    .prepare(
      `UPDATE food_entries
       SET food_log_date = '2025-12-31'
       WHERE user_id = ?`,
    )
    .run(user.id);
  noGoalDatabase.close();
  await page.goto("/?date=2025-12-31");
  await expect(
    page.getByRole("article", {
      name: "Protein: 120.5; no active target",
    }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Show fiber, sugar, and sodium" })
    .click();
  await expect(
    page.getByRole("article", {
      name: "Fiber: 0 known; no active target; incomplete",
    }),
  ).toBeVisible();

  const accessibilityScan = await new AxeBuilder({ page }).analyze();
  expect(accessibilityScan.violations).toEqual([]);
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
  await expect(page.getByText("Plain nonfat Greek yogurt")).toBeVisible();
  await expect(page.getByText("Vanished catalog food")).toHaveCount(0);
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
  await expect(page.getByText("Unsafe provider measurement")).toBeVisible();
  await expect(page.getByText("Hidden in production")).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Unsafe provider measurement/ }),
  ).toHaveCount(0);
  await expectCatalogResponsive(page);

  const unsafeDetail = await page.goto(
    "/?date=2026-08-29&food=9999&query=unsafe",
  );
  expect(unsafeDetail?.status()).toBe(422);
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

test("food selection immediately reveals the pending detail destination", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.91" });
  await registerAndSetup(page, "catalog.pending-destinations");

  await page.getByRole("button", { name: "Add Food" }).click();
  await page
    .getByRole("searchbox", { name: "Search United States foods" })
    .fill("yogurt");
  await page.getByRole("button", { name: "Search" }).click();

  let releaseDetail!: () => void;
  const detailGate = new Promise<void>((resolve) => {
    releaseDetail = resolve;
  });
  await page.route(
    /[?&]food=1001(?:&|$)/,
    async (route) => {
      await detailGate;
      await route.continue();
    },
    { times: 1 },
  );

  const selection = page
    .getByRole("link", { name: /Plain nonfat Greek yogurt/ })
    .click();
  await expect(
    page.getByRole("status", { name: "Loading food details" }),
  ).toBeVisible();
  await expect(
    page.getByRole("searchbox", { name: "Search United States foods" }),
  ).toHaveCount(0);
  for (const viewport of [
    { height: 844, width: 390 },
    { height: 900, width: 800 },
    { height: 900, width: 1_120 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(
      page.getByRole("status", { name: "Loading food details" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  const pendingDetailAccessibility = await new AxeBuilder({ page }).analyze();
  expect(pendingDetailAccessibility.violations).toEqual([]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(
    page
      .getByRole("status", { name: "Loading food details" })
      .locator("div")
      .first(),
  ).toHaveCSS("animation-name", "none");
  releaseDetail();
  await selection;

  await expect(page.getByText("Saved as a Nutrition Snapshot")).toBeVisible();
});

test("food logging immediately reveals a pending Daily log row", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.92" });
  await registerAndSetup(page, "catalog.pending-log");

  await page.getByRole("button", { name: "Add Food" }).click();
  await page
    .getByRole("searchbox", { name: "Search United States foods" })
    .fill("yogurt");
  await page.getByRole("button", { name: "Search" }).click();
  await page
    .getByRole("link", { name: /Plain nonfat Greek yogurt/ })
    .click();
  await expect(page.getByText("Saved as a Nutrition Snapshot")).toBeVisible();

  let releaseLog!: () => void;
  let releaseReload!: () => void;
  let signalLogRequest!: () => void;
  let signalReloadRequest!: () => void;
  const logGate = new Promise<void>((resolve) => {
    releaseLog = resolve;
  });
  const reloadGate = new Promise<void>((resolve) => {
    releaseReload = resolve;
  });
  const logRequestStarted = new Promise<void>((resolve) => {
    signalLogRequest = resolve;
  });
  const reloadRequestStarted = new Promise<void>((resolve) => {
    signalReloadRequest = resolve;
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (
      request.method() === "POST" &&
      request.postData()?.includes("intent=log-food")
    ) {
      signalLogRequest();
      await logGate;
    } else if (
      request.method() === "GET" &&
      new URL(request.url()).searchParams.get("date") === "2026-08-29" &&
      !new URL(request.url()).searchParams.has("food")
    ) {
      signalReloadRequest();
      await reloadGate;
    }
    await route.continue();
  });

  const submission = page
    .getByRole("button", { name: "Add to Food Log" })
    .click();
  await logRequestStarted;
  await expect(page.getByRole("dialog", { name: "Add Food" })).toHaveCount(0);
  await expect(
    page.getByRole("status", { name: "Adding food to Daily log" }),
  ).toBeVisible();
  for (const viewport of [
    { height: 844, width: 390 },
    { height: 900, width: 800 },
    { height: 900, width: 1_120 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(
      page.getByRole("status", { name: "Adding food to Daily log" }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  const pendingLogAccessibility = await new AxeBuilder({ page }).analyze();
  expect(pendingLogAccessibility.violations).toEqual([]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(
    page
      .getByRole("status", { name: "Adding food to Daily log" })
      .locator("span")
      .first(),
  ).toHaveCSS("animation-name", "none");
  releaseLog();
  await reloadRequestStarted;
  await expect(page.getByRole("dialog", { name: "Add Food" })).toHaveCount(0);
  await expect(
    page.getByRole("status", { name: "Adding food to Daily log" }),
  ).toBeVisible();
  releaseReload();
  await submission;

  await expect(
    page.getByRole("link", { name: /Plain nonfat Greek yogurt.*100\.3 kcal/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("status", { name: "Adding food to Daily log" }),
  ).toHaveCount(0);
});

test("an authenticated user can correct and delete one Food Entry", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.83" });
  await registerAndSetup(page, "food.entry.edit");
  await page.getByRole("button", { name: "Add Food" }).click();
  await page
    .getByRole("searchbox", { name: "Search United States foods" })
    .fill("yogurt");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("link", { name: /Plain nonfat Greek yogurt/ }).click();
  await page.getByRole("button", { name: "Add to Food Log" }).click();

  await page
    .getByRole("link", { name: /Plain nonfat Greek yogurt.*100\.3 kcal/ })
    .click();
  const editor = page.getByRole("dialog", { name: "Edit Food Entry" });
  await expect(editor).toBeVisible();
  await expect(editor.getByText("Changes affect this occurrence only.")).toBeVisible();
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  await expect(page.getByLabel("Food name")).toHaveValue(
    "Plain nonfat Greek yogurt",
  );
  await expect(page.getByLabel("Measurement")).toHaveValue(
    "serving:g:170000000",
  );
  await expect(page.getByLabel("Fiber (g)")).toHaveValue("");
  await expect(page.getByLabel("Fat (g)")).toHaveValue("0");
  await expectFoodEntryEditorResponsive(page);
  const openEditorAccessibility = await new AxeBuilder({ page }).analyze();
  expect(openEditorAccessibility.violations).toEqual([]);

  await page.getByLabel("Food name").fill(" ");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(editor.getByRole("alert")).toContainText(
    "Food Entry request is invalid",
  );
  await expectFoodEntryEditorResponsive(page);
  await expect(editor.getByRole("alert")).toContainText(
    "Food Entry request is invalid",
  );

  await page.getByLabel("Food name").fill("Breakfast yogurt");
  await page.getByLabel("Measurement").selectOption("base:g:100000000");
  await page.getByLabel("Quantity").fill("0.5");
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("29.5");
  await expect(page.getByLabel("Protein (g)")).toHaveValue("5.295");
  await page.getByLabel("Carbohydrate (g)").fill("");
  await page.getByLabel("Fat (g)").fill("0");

  const editForm = editor.locator("form");
  const editFields = await editForm.evaluate((form) => {
    const fields = Object.fromEntries(
      new FormData(form as HTMLFormElement).entries(),
    );
    fields.intent = "update-food";
    return fields;
  });
  const malformedStatus = await page.evaluate(async (fields) => {
    const body = new URLSearchParams(fields as Record<string, string>);
    body.set("selectedMeasurementId", "invented-measurement");
    const response = await fetch("/?index", {
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    return response.status;
  }, editFields);
  expect(malformedStatus).toBe(400);

  let releaseUpdate!: () => void;
  const updateGate = new Promise<void>((resolve) => {
    releaseUpdate = resolve;
  });
  const delayUpdate = async (route: import("@playwright/test").Route) => {
    if (route.request().method() === "POST") await updateGate;
    await route.continue();
  };
  await page.route("**/*", delayUpdate);
  const saveClick = page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
  await expectFoodEntryEditorResponsive(page);
  await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
  releaseUpdate();
  await saveClick;
  await page.unroute("**/*", delayUpdate);
  await expect(page).toHaveURL(/date=2026-08-29&notice=updated/);
  await expect(page.getByRole("status")).toContainText(
    "Food Entry updated. Daily totals refreshed.",
  );
  await expectFoodEntryStatusResponsive(
    page,
    "Food Entry updated. Daily totals refreshed.",
  );
  await expect(page.getByText("Breakfast yogurt", { exact: true })).toBeVisible();
  await expect(page.getByText("29.5 kcal", { exact: true })).toBeVisible();

  const database = openBrowserTestDatabase();
  const persisted = database
    .prepare(
      `SELECT
       authoritative_nutrition AS authoritativeNutrition,
        authoritative_carbohydrate_milligrams AS carbohydrateMilligrams,
        authoritative_fat_milligrams AS fatMilligrams
       FROM food_entries f
       JOIN users u ON u.id = f.user_id
       WHERE f.original_name = ? AND u.username_normalized = ?`,
    )
    .get("Plain nonfat Greek yogurt", "food.entry.edit") as {
    authoritativeNutrition: string;
    carbohydrateMilligrams: number | null;
    fatMilligrams: number | null;
  };
  database.close();
  expect(JSON.parse(persisted.authoritativeNutrition)).toMatchObject({
    carbohydrateMilligrams: { amount: 3.53 },
  });
  expect(persisted).toMatchObject({
    carbohydrateMilligrams: null,
    fatMilligrams: 0,
  });

  const staleStatus = await page.evaluate(async (fields) => {
    const response = await fetch("/?index", {
      body: new URLSearchParams(fields as Record<string, string>),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    return response.status;
  }, editFields);
  expect(staleStatus).toBe(409);

  const entryId = String(editFields.entryId);
  const otherContext = await page.context().browser()!.newContext();
  await otherContext.setExtraHTTPHeaders({
    "X-Test-Client-IP": "203.0.113.84",
  });
  const otherPage = await otherContext.newPage();
  await registerAndSetup(otherPage, "food.entry.other");
  const unavailableRead = await otherPage.goto(
    `/?date=2026-08-29&entry=${entryId}`,
  );
  expect(unavailableRead?.status()).toBe(404);
  await otherPage.goto("/?date=2026-08-29");
  const otherCsrfToken = await otherPage
    .locator("form")
    .filter({ has: otherPage.getByRole("button", { name: "Add Food" }) })
    .locator('input[name="csrfToken"]')
    .inputValue();
  const unavailableMutations = await otherPage.evaluate(
    async ({ csrfToken, entryId, expectedUpdatedAt }) => {
      const submit = (intent: "delete-food" | "update-food") =>
        fetch("/?index", {
          body: new URLSearchParams({
            carbohydrateGrams: "",
            csrfToken,
            date: "2026-08-29",
            energyKcal: "",
            entryId,
            expectedUpdatedAt,
            fatGrams: "",
            fiberGrams: "",
            intent,
            name: "Unavailable",
            proteinGrams: "",
            quantity: "1",
            selectedMeasurementId: "base:g:100000000",
            sodiumMilligrams: "",
            sugarGrams: "",
          }),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          method: "POST",
        });
      const update = await submit("update-food");
      const deletion = await submit("delete-food");
      return [update.status, deletion.status];
    },
    {
      csrfToken: otherCsrfToken,
      entryId,
      expectedUpdatedAt: String(editFields.expectedUpdatedAt),
    },
  );
  expect(unavailableMutations).toEqual([404, 404]);
  await otherContext.close();

  await page.getByRole("link", { name: /Breakfast yogurt.*29\.5 kcal/ }).click();
  await page.getByRole("button", { name: "Delete entry" }).click();
  await expect(editor.getByText("Delete this Food Entry?")).toBeVisible();
  await expectFoodEntryEditorResponsive(page);
  await expect(editor.getByText("Delete this Food Entry?")).toBeVisible();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page).toHaveURL(/date=2026-08-29&notice=deleted/);
  await expect(page.getByRole("status")).toContainText(
    "Food Entry deleted. Daily totals updated.",
  );
  await expectFoodEntryStatusResponsive(
    page,
    "Food Entry deleted. Daily totals updated.",
  );
  await expect(page.getByText("No entries for this day")).toBeVisible();

  const accessibilityScan = await new AxeBuilder({ page }).analyze();
  expect(accessibilityScan.violations).toEqual([]);
});

test("a stale Food Entry editor refreshes to the current occurrence and can retry", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.85" });
  await registerAndSetup(page, "food.entry.stale-recovery");
  await page.getByRole("button", { name: "Add Food" }).click();
  await page
    .getByRole("searchbox", { name: "Search United States foods" })
    .fill("yogurt");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("link", { name: /Plain nonfat Greek yogurt/ }).click();
  await page.getByRole("button", { name: "Add to Food Log" }).click();
  await page
    .getByRole("link", { name: /Plain nonfat Greek yogurt.*100\.3 kcal/ })
    .click();

  const editor = page.getByRole("dialog", { name: "Edit Food Entry" });
  const concurrentStatus = await editor
    .locator("form")
    .evaluate(async (form) => {
      const fields = Object.fromEntries(
        new FormData(form as HTMLFormElement).entries(),
      );
      fields.intent = "update-food";
      fields.name = "Updated elsewhere";
      const response = await fetch("/?index", {
        body: new URLSearchParams(fields as Record<string, string>),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        method: "POST",
      });
      return response.status;
    });
  expect(concurrentStatus).toBe(200);

  await page.getByLabel("Food name").fill("Stale local draft");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(editor.getByRole("alert")).toContainText(
    "changed after you opened it",
  );
  await expect(page.getByLabel("Food name")).toHaveValue("Updated elsewhere");

  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/date=2026-08-29&notice=updated/);
  await expect(
    page.getByText("Updated elsewhere", { exact: true }),
  ).toBeVisible();
});

test("delete pending state names only the destructive mutation", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.86" });
  await registerAndSetup(page, "food.entry.delete-pending");
  await page.getByRole("button", { name: "Add Food" }).click();
  await page
    .getByRole("searchbox", { name: "Search United States foods" })
    .fill("yogurt");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("link", { name: /Plain nonfat Greek yogurt/ }).click();
  await page.getByRole("button", { name: "Add to Food Log" }).click();
  await page
    .getByRole("link", { name: /Plain nonfat Greek yogurt.*100\.3 kcal/ })
    .click();
  await page.getByRole("button", { name: "Delete entry" }).click();

  let releaseDelete!: () => void;
  const deleteGate = new Promise<void>((resolve) => {
    releaseDelete = resolve;
  });
  const delayDelete = async (route: import("@playwright/test").Route) => {
    if (route.request().method() === "POST") await deleteGate;
    await route.continue();
  };
  await page.route("**/*", delayDelete);
  const deleteClick = page
    .getByRole("button", { name: "Delete", exact: true })
    .click();
  try {
    await expect(
      page.getByRole("button", { name: "Deleting…" }),
    ).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Save changes" }),
    ).toBeDisabled();
    await expect(page.getByRole("button", { name: "Saving…" })).toHaveCount(0);
  } finally {
    releaseDelete();
  }
  await deleteClick;
  await page.unroute("**/*", delayDelete);
  await expect(page).toHaveURL(/date=2026-08-29&notice=deleted/);
});
