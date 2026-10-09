import { installSimulatedBarcodeCamera } from "./barcode-camera-fixture";
import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import {
  bootstrapOrSignInBrowserTestUser,
  configureBarcodeContact,
  expect,
  openBrowserTestDatabase,
  recordedOffApiRequests,
  signInProvisionedMember,
  test,
} from "./reset-database";
import packageJson from "../../package.json" with { type: "json" };

const validPassword = "correct horse 🔐 battery";

async function completeSetupForTestUser(
  page: Page,
  username = "food.log.navigation",
  timeZone = "America/New_York",
) {
  await bootstrapOrSignInBrowserTestUser(page, username, validPassword);
  await page.getByLabel("Time zone").fill(timeZone);
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL("/");
}

async function openUsdaSearch(page: Page) {
  await page.getByRole("button", { name: "Add Food" }).click();
  await page.getByRole("link", { name: /Search for food/ }).click();
  await expect(
    page.getByRole("searchbox", { name: "Search local foods" }),
  ).toBeVisible();
}
async function expectCatalogResponsive(page: Page) {
  for (const viewport of [
    { height: 908, width: 362 },
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

/** The fields a dialog form posts besides its submit button. */
async function postedFields(submitButton: Locator): Promise<Record<string, string>> {
  return submitButton
    .locator("xpath=ancestor::form")
    .evaluate((form) => Object.fromEntries(
      [...new FormData(form as HTMLFormElement).entries()]
        .filter(([name]) => name !== "csrfToken")
        .map(([name, value]) => [name, String(value)]),
    ));
}

/** Fills a dialog field and waits until the value holds, so a late re-render cannot drop it. */
async function fillSteadily(field: Locator, value: string) {
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 1_000 });
  }).toPass();
}


test("today, historical navigation, calendar access, travel, and future rejection", async ({
  browser,
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.80" });
  await completeSetupForTestUser(page);

  await expect(
    page.getByRole("heading", { name: "Today's Food Log" }),
  ).toBeVisible();
  await expect(
    page.getByText("Saturday, August 29, 2026", { exact: true }).first(),
  ).toBeVisible();
  const quickLog = page.getByRole("group", { name: "Quick log" });
  await expect(
    quickLog.getByRole("button", { name: "Add Food" }),
  ).toBeVisible();
  await expect(
    quickLog.getByRole("button", { name: "Add Water" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Dismiss notification" })).toHaveCount(0);
  expect(
    await quickLog.evaluate((element) =>
      getComputedStyle(element.parentElement!).position,
    ),
  ).toBe("fixed");
  expect(
    await quickLog.evaluate((element) =>
      getComputedStyle(element.parentElement!).pointerEvents,
    ),
  ).toBe("none");
  expect(
    await quickLog.evaluate((element) => getComputedStyle(element).pointerEvents),
  ).toBe("auto");
  expect(
    await quickLog.evaluate((element) => getComputedStyle(element).backgroundColor),
  ).toBe("rgba(0, 0, 0, 0)");

  for (const viewport of [
    { height: 844, width: 390 },
    { height: 900, width: 800 },
    { height: 900, width: 1_120 },
  ]) {
    await page.setViewportSize(viewport);
    // An empty day carries its own actions below the desktop layout, so
    // floating buttons never cover the empty-state guidance.
    const emptyDayActions = page.getByRole("group", { name: "Add to this day" });
    const visibleActions = viewport.width < 1_120 ? emptyDayActions : quickLog;
    await expect(viewport.width < 1_120 ? quickLog : emptyDayActions).toBeHidden();
    await expect(visibleActions).toBeVisible();
    const quickLogBox = await visibleActions.boundingBox();
    expect(quickLogBox).not.toBeNull();
    expect(quickLogBox!.x).toBeGreaterThanOrEqual(0);
    expect(quickLogBox!.x + quickLogBox!.width).toBeLessThanOrEqual(viewport.width);
    expect(quickLogBox!.y + quickLogBox!.height).toBeLessThanOrEqual(viewport.height);
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
    travelPage.getByText("Food Log date 2026-08-28 · Time zone America/New_York", { exact: true }),
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

test("date strip stays put and supports mobile swipes across weeks", async ({
  browser,
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({
    "X-Test-Client-IP": "203.0.113.89",
    "X-Test-Food-Log-Now": "2026-09-05T18:00:00.000Z",
  });
  await completeSetupForTestUser(page, "food.log.date.swipes");
  const rail = page.getByLabel("Nearby dates");
  const week = (await rail.locator('div:not([aria-hidden]) > a, div:not([aria-hidden]) > button').allTextContents()).join("");
  await page.getByRole("link", { name: "Fri 4", exact: true }).click();
  await expect(page).toHaveURL("/?date=2026-09-04");
  expect((await rail.locator('div:not([aria-hidden]) > a, div:not([aria-hidden]) > button').allTextContents()).join("")).toBe(week);
  await expect(page.getByRole("link", { name: "Sat 5", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Browse past dates" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open calendar" })).toBeVisible();
  await page.getByRole("link", { name: "Browse past dates" }).click();
  await expect(page).toHaveURL("/?date=2026-08-28");

  const touchContext = await browser.newContext({
    extraHTTPHeaders: { "X-Test-Food-Log-Now": "2026-09-05T18:00:00.000Z" },
    hasTouch: true,
    isMobile: true,
    storageState: await context.storageState(),
    viewport: { height: 844, width: 390 },
  });
  const mobile = await touchContext.newPage();
  await mobile.goto("/");
  const mobileRail = mobile.getByLabel("Nearby dates");
  for (const width of [320, 390, 800]) {
    await mobile.setViewportSize({ height: 844, width });
    await expect(mobile.getByRole("link", { name: "Browse past dates" })).toBeHidden();
    await expect(mobile.getByRole("link", { name: "Open calendar" })).toBeHidden();
    const bounds = await mobileRail.boundingBox();
    for (const day of await mobileRail.locator("a, button").all()) {
      await expect(day).toBeVisible();
      const box = await day.boundingBox();
      expect(box!.x).toBeGreaterThanOrEqual(bounds!.x);
      expect(box!.x + box!.width).toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
    }
    expect(await mobile.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await mobile.setViewportSize({ height: 844, width: 390 });
  const saturday = mobile.getByRole("link", { name: "Sat 5", exact: true });
  const saturdayPosition = await saturday.boundingBox();
  await mobile.getByRole("link", { name: "Fri 4", exact: true }).tap();
  await expect(mobile).toHaveURL("/?date=2026-09-04");
  expect(await saturday.boundingBox()).toEqual(saturdayPosition);
  await saturday.tap();
  await expect(mobile).toHaveURL("/?date=2026-09-05");

  const client = await touchContext.newCDPSession(mobile);
  async function swipe(dx: number, dy = 0, cancel = false) {
    const box = (await mobileRail.boundingBox())!;
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await client.send("Input.dispatchTouchEvent", {
      touchPoints: [{ x, y }], type: "touchStart",
    });
    for (const progress of [0.25, 0.5, 0.75, 1]) {
      await client.send("Input.dispatchTouchEvent", {
        touchPoints: [{ x: x + dx * progress, y: y + dy * progress }],
        type: "touchMove",
      });
    }
    if (dx === 100 && dy === 0 && !cancel) {
      const activeWeek = mobileRail.locator("div:not([aria-hidden]):has(> a[aria-current=\"date\"])");
      await expect.poll(async () => (await activeWeek.boundingBox())!.x - box.x).toBeGreaterThan(80);
      await expect.poll(async () => (await activeWeek.boundingBox())!.x - box.x).toBeLessThan(115);
    }
    await client.send("Input.dispatchTouchEvent", {
      touchPoints: [], type: cancel ? "touchCancel" : "touchEnd",
    });
  }
  await swipe(100);
  await expect(mobile).toHaveURL("/?date=2026-08-29");
  await expect(mobile.getByRole("link", { name: "Sat 29", exact: true })).toHaveAttribute("aria-current", "date");
  await swipe(-100);
  await expect(mobile).toHaveURL("/?date=2026-09-05");
  expect(await saturday.boundingBox()).toEqual(saturdayPosition);
  await swipe(-100);
  await expect(mobile).toHaveURL("/?date=2026-09-05");
  await swipe(-20);
  await expect(mobile).toHaveURL("/?date=2026-09-05");
  await swipe(5, -70);
  await expect(mobile).toHaveURL("/?date=2026-09-05");
  await mobileRail.scrollIntoViewIfNeeded();
  await swipe(100, 0, true);
  await expect(mobile).toHaveURL("/?date=2026-09-05");
  await mobile.getByRole("link", { name: "Mon 31", exact: true }).tap();
  await expect(mobile).toHaveURL("/?date=2026-08-31");
  await swipe(100);
  await expect(mobile).toHaveURL("/?date=2026-08-24");
  await expect(mobile.getByRole("link", { name: "Mon 24", exact: true })).toHaveAttribute("aria-current", "date");
  await mobile.emulateMedia({ reducedMotion: "reduce" });
  await swipe(-100);
  await expect(mobile).toHaveURL("/?date=2026-08-31");
  await mobile.getByRole("link", { name: "Sat 5", exact: true }).focus();
  await mobile.keyboard.press("Enter");
  await expect(mobile).toHaveURL("/?date=2026-09-05");
  await touchContext.close();
});

test("the full stack resolves UTC boundaries and both DST transitions", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.81" });
  await completeSetupForTestUser(page, "food.log.boundaries");

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
  await completeSetupForTestUser(page, "nutrition.progress");

  await expect(
    page.getByRole("progressbar", { name: "Calorie progress" }),
  ).toHaveAttribute("aria-valuetext", "0 of 2,050 kcal target");
  await expect(page.getByText("Incomplete", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("article", { name: /Protein: 0 of 120 g target/ }),
  ).toBeVisible();
  // Desktop lays out both nutrient pages, so the second page stays exposed.
  await expect(
    page.getByRole("article", { name: /Sugar: 0 of 50 g maximum/ }),
  ).toBeVisible();

  await openUsdaSearch(page);
  await page
    .getByRole("searchbox", { name: "Search local foods" })
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
      `UPDATE food_events
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
      `UPDATE daily_goals
       SET calorie_target_milli_kcal = 1000000, water_target_ounces = '67.628',
           protein_target_milligrams = 100000, carbohydrate_target_milligrams = 200000,
           fat_target_milligrams = 60000, fiber_target_milligrams = 20000,
           sugar_maximum_milligrams = 40000, sodium_maximum_milligrams = 2000
       WHERE user_id = ?`,
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

  // Desktop shows both nutrient pages at once, so it has no page controls.
  await expect(
    page.getByRole("group", { name: "Nutrition pages" }),
  ).toHaveCount(0);
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
      `UPDATE food_events
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
  const secondPage = touchPage.getByRole("button", {
    name: "Show fiber, sugar, and sodium",
  });
  await secondPage.focus();
  await touchPage.keyboard.press("Enter");
  await expect(secondPage).toHaveAttribute("aria-pressed", "true");
  await expect(
    touchPage.getByRole("article", {
      name: "Fiber: 0 known of 20 g target; incomplete",
    }),
  ).toBeVisible();
  await touchPage
    .getByRole("button", { name: "Show protein, carbohydrate, and fat" })
    .click();
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
  ).toHaveAttribute("aria-valuetext", "0 of 1,000 kcal target");

  // A day before Setup is measured against the current Daily Goal too.
  const beforeSetupDatabase = openBrowserTestDatabase();
  beforeSetupDatabase
    .prepare(
      `UPDATE food_events
       SET log_date = '2025-12-31T17:00:00.000Z'
       WHERE user_id = ?`,
    )
    .run(user.id);
  beforeSetupDatabase.close();
  await page.goto("/?date=2025-12-31");
  await expect(
    page.getByRole("article", {
      name: "Protein: 120.5 of 100 g target",
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("article", {
      name: "Fiber: 0 known of 20 g target; incomplete",
    }),
  ).toBeVisible();

  const accessibilityScan = await new AxeBuilder({ page }).analyze();
  expect(accessibilityScan.violations).toEqual([]);
});

test("authenticated USDA search and logging preserve a local Nutrition Snapshot, and a resubmission records it again", async ({
  browser,
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.82" });
  await completeSetupForTestUser(page, "catalog.search");

  await page.getByRole("button", { name: "Add Food" }).click();
  await expect(page).toHaveURL(/food=choose/);
  await expect(page.getByRole("link", { name: /Search for food/ })).toBeVisible();
  // An administrator sees Scan barcode before the Open Food Facts contact is set; it opens setup.
  await expect(page.getByRole("button", { name: /Scan barcode/ })).toBeVisible();
  await page.getByRole("link", { name: /Search for food/ }).click();
  await expect(page).toHaveURL(/food=search/);
  await expect(page.getByRole("dialog", { name: "Add Food" })).toBeVisible();
  await expect(
    page.getByText("Nothing changes in your Food Log until a later confirmation step."),
  ).toBeVisible();
  await expect(page.locator("body")).toHaveCSS("overflow", "hidden");
  const closeFoodSearch = page.getByRole("link", {
    name: "Close food search",
  });
  await expect(
    page.getByRole("searchbox", { name: "Search local foods" }),
  ).toBeFocused();
  const providerLink = page.getByRole("link", {
    name: "USDA FoodData Central",
    exact: true,
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
    .getByRole("searchbox", { name: "Search local foods" })
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
    .getByRole("searchbox", { name: "Search local foods" })
    .fill("yogurt");
  const searchClick = page.getByRole("button", { name: "Search" }).click();
  await expect(
    page.getByRole("status").getByText("Searching USDA foods"),
  ).toBeVisible();
  await expectCatalogResponsive(page);
  releaseSearch();
  await searchClick;
  await expect(page.getByText("Plain nonfat Greek yogurt")).toBeVisible();
  await expectCatalogResponsive(page);

  await page
    .getByRole("searchbox", { name: "Search local foods" })
    .fill("none");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("No foods found")).toBeVisible();
  await expect(page.getByText("Plain nonfat Greek yogurt")).toHaveCount(0);
  await expectCatalogResponsive(page);

  for (const [query, status, title] of [
    ["not-installed", 503, "USDA Foundation is not installed"],
    ["malformed", 500, "USDA catalog data could not be used"],
  ] as const) {
    const response = await page.goto(
      `/?date=2026-08-29&food=search&query=${query}`,
    );
    expect(response?.status()).toBe(status);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
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
    .getByRole("searchbox", { name: "Search local foods" })
    .fill("yogurt");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByText("Plain nonfat Greek yogurt")).toBeVisible();
  await expect(
    page.getByText("Example Dairy Co. · 1 container · 170 g"),
  ).toBeVisible();
  await expect(page.getByText("Basic food · USDA", { exact: true })).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "USDA FoodData Central" }),
  ).toBeVisible();
  await expectCatalogResponsive(page);

  await page
    .getByRole("searchbox", { name: "Search local foods" })
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
    .getByRole("searchbox", { name: "Search local foods" })
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
  expect(submission).toMatchObject({ intent: "log", method: "lookup", providerFoodId: "1001", quantity: "1.5" });
  // Without idempotency keys a resubmitted form records the food again, as Water Events do.
  const statuses = await page.evaluate(async (fields) => {
    const body = new URLSearchParams(fields as Record<string, string>);
    const first = await fetch("/food-events", {
      body,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    const second = await fetch("/food-events", {
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
  ).toHaveCount(2);
  await expect(page.getByText("USDA FoodData Central · Branded")).toHaveCount(2);
  await expect(page.getByRole("article").getByText("150.5 kcal")).toHaveCount(2);
  await expect(page.locator("img")).toHaveCount(0);

  const anonymous = await browser.newContext({ ignoreHTTPSErrors: true });
  const anonymousPage = await anonymous.newPage();
  await anonymousPage.goto("/?food=search&query=yogurt");
  await expect(anonymousPage).toHaveURL(/\/login$/);
  await anonymous.close();

  const accessibilityScan = await new AxeBuilder({ page }).analyze();
  expect(accessibilityScan.violations).toEqual([]);
});

test("authenticated manual barcode confirmation creates one attributed serving snapshot", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.93" });
  configureBarcodeContact();
  await completeSetupForTestUser(page, "catalog.barcode");

  await page.getByRole("button", { name: "Add Food" }).click();
  await page.getByRole("link", { name: /Scan barcode/ }).click();
  const barcodeInput = page.getByLabel("Enter barcode");
  await expect(barcodeInput).toBeVisible();
  await expect(barcodeInput).toBeFocused();
  await expect(page.getByRole("link", { name: "Search for food" })).toBeVisible();
  await expectCatalogResponsive(page);

  await barcodeInput.fill("123");
  await page.getByRole("button", { name: "Look up" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Enter a supported 7, 8, 12, 13, or 14 digit barcode.",
  );

  await barcodeInput.fill("034000470693");
  await page.getByRole("button", { name: "Look up" }).click();
  await expect(page.getByRole("heading", { name: "Example cereal" })).toBeVisible();
  await expect(barcodeInput).toBeHidden();
  await expect(page.getByRole("link", { name: "Back to scanner" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Search for food" })).toHaveCount(0);
  await expect(page.getByText("Barcode 0034000470693")).toBeVisible();
  await expect(page.getByLabel("Measurement", { exact: true })).toHaveValue("serving");
  await expect(page.getByText("180 kcal")).toBeVisible();
  await expect(page.getByText("24 g")).toBeVisible();
  await expect(page.getByText("0 g", { exact: true })).toBeVisible();
  await expect(page.getByText("Not reported").first()).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Open Food Facts" }),
  ).toBeVisible();
  await expect(page.locator("img")).toHaveCount(0);
  await expect(barcodeInput).toBeHidden();
  const quantity = page.getByLabel("Quantity");
  await expect(quantity).toHaveValue("1");
  await quantity.fill("0.5");
  await expect(page.getByText("90 kcal")).toBeVisible();
  await expect(page.getByText("12 g")).toBeVisible();
  await expect(page.getByText("No entries for this day")).toBeVisible();
  await expectCatalogResponsive(page);

  await page.getByRole("button", { name: "Add to Food Log" }).click();
  await expect(page).toHaveURL("/?date=2026-08-29");
  const savedEntry = page.getByRole("article").filter({
    hasText: "Example cereal",
  });
  await expect(savedEntry).toHaveCount(1);
  await expect(savedEntry).toContainText("Open Food Facts");
  await expect(savedEntry).toContainText("1 serving (30 g) × 0.5");
  await expect(savedEntry).toContainText("90 kcal");
  await expect(page.getByText("Incomplete", { exact: true }).first()).toBeVisible();
  await expect(page.locator("img")).toHaveCount(0);

  for (const [barcode, status, title] of [
    ["0000000000001", 404, "Product not found"],
    ["0000000000002", 404, "Product not found"],
    ["0000000000004", 503, "Open Food Facts isn't responding"],
    ["0000000000005", 503, "Open Food Facts isn't responding"],
  ] as const) {
    const lookup = await page.goto(
      `/?date=2026-08-29&food=barcode&barcode=${barcode}`,
    );
    expect(lookup?.status()).toBe(status);
    await expect(page.getByRole("heading", { name: title })).toBeVisible();
    await expect(page.getByLabel("Enter barcode")).toBeVisible();
    await expect(page.getByRole("link", { name: "Search for food" })).toBeVisible();
  }

  await page.goto("/?date=2026-08-29&food=barcode&barcode=0000000000006");
  await expect(
    page.getByRole("heading", { name: "Unnamed product · 0000000000006" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Back to scanner" }).click();
  await expect(page.getByLabel("Enter barcode")).toBeFocused();
  await page.getByRole("link", { name: "Search for food" }).click();
  await expect(
    page.getByRole("searchbox", { name: "Search local foods" }),
  ).toBeVisible();

  const accessibilityScan = await new AxeBuilder({ page }).analyze();
  expect(accessibilityScan.violations).toEqual([]);
});

test("an administrator enables barcode lookup with a contact email that identifies every Open Food Facts request", async ({
  browser,
  context,
  page,
}, testInfo) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.97" });
  await completeSetupForTestUser(page, "barcode.setup.admin");

  await page.getByRole("button", { name: "Add Food" }).click();
  // The four Add Food methods sit in one row where the dialog is wide enough.
  const methods = page.getByLabel("Add Food methods").locator(":scope > *");
  await expect(methods).toHaveCount(4);
  const methodTops = await methods.evaluateAll((elements) => elements.map((element) => Math.round(element.getBoundingClientRect().top)));
  expect(new Set(methodTops).size).toBe(1);
  await page.screenshot({ path: testInfo.outputPath("add-food-methods-desktop.png") });
  await page.getByRole("button", { name: "Scan barcode" }).click();
  const setup = page.getByRole("dialog", { name: "Barcode scanning is not enabled" });
  await expect(setup).toBeVisible();

  // On phones down to 320 px, the pop-up's two choices stay side by side, whole and inside the
  // dialog, and the methods stack.
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    const dialogBox = (await setup.boundingBox())!;
    const choices = [setup.getByRole("button", { name: "Cancel" }), setup.getByRole("link", { name: "Go to Food Catalogs →" })];
    const [cancelBox, continueBox] = await Promise.all(choices.map(async (choice) => (await choice.boundingBox())!));
    expect(Math.abs(cancelBox.y - continueBox.y)).toBeLessThan(2);
    expect(cancelBox.x + cancelBox.width).toBeLessThanOrEqual(continueBox.x);
    for (const box of [cancelBox, continueBox]) {
      expect(box.x).toBeGreaterThanOrEqual(dialogBox.x);
      expect(box.x + box.width).toBeLessThanOrEqual(dialogBox.x + dialogBox.width);
    }
    for (const choice of choices) {
      expect(await choice.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    await page.screenshot({ path: testInfo.outputPath(`admin-setup-popup-${width}.png`) });
  }
  const stackedTops = await methods.evaluateAll((elements) => elements.map((element) => Math.round(element.getBoundingClientRect().top)));
  expect(new Set(stackedTops).size).toBe(4);
  await page.setViewportSize({ width: 1280, height: 720 });
  await expect(setup).toContainText("Add one in Food Catalogs to enable scanning for every member.");
  await expect(page.getByLabel("Enter barcode")).toHaveCount(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");
  await expect(setup).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Add Food" })).toBeVisible();
  await page.getByRole("button", { name: "Scan barcode" }).click();
  await setup.getByRole("link", { name: "Go to Food Catalogs →" }).click();
  await expect(page).toHaveURL("/settings/catalogs");

  const off = page.locator('section[aria-labelledby="open-food-facts-heading"]');
  await expect(off).toContainText("○ Not configured");
  await expect(off).toContainText("Data available under the ODbL.");
  await off.getByLabel("Contact email").fill("family@example.com");
  await off.getByRole("button", { name: "Save and enable scanning" }).click();
  await expect(off.getByRole("status")).toHaveText("✓ Barcode scanning enabled.");
  await expect(off).toContainText("● Enabled");
  await expect(off).toContainText("family@example.com");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

  const requestsBefore = recordedOffApiRequests().length;
  await page.goto("/?date=2026-08-29&food=choose");
  await page.getByRole("link", { name: /Scan barcode/ }).click();
  await page.getByLabel("Enter barcode").fill("034000470693");
  await page.getByRole("button", { name: "Look up" }).click();
  await expect(page.getByRole("heading", { name: "Example cereal" })).toBeVisible();
  await page.getByLabel("Measurement", { exact: true }).selectOption("g");
  await page.getByLabel("Quantity").fill("45");
  await expect(page.getByText("270 kcal")).toBeVisible();
  await page.getByRole("button", { name: "Add to Food Log" }).click();
  await expect(page).toHaveURL("/?date=2026-08-29");
  await expect(page.getByRole("article").filter({ hasText: "Example cereal" })).toContainText("270 kcal");
  const requests = recordedOffApiRequests().slice(requestsBefore);
  expect(requests.map((request) => new URL(request.url).pathname)).toEqual([
    "/api/v3.5/product/034000470693",
    "/api/v3.5/product/0034000470693",
  ]);
  for (const request of requests) {
    expect(request.userAgent).toBe(`OpenCalorieTracker/${packageJson.version} (family@example.com)`);
  }

  expect((await page.goto("/?date=2026-08-29&food=barcode&barcode=0000000000004"))?.status()).toBe(503);
  await expect(page.getByRole("heading", { name: "Open Food Facts isn't responding" })).toBeVisible();
  await expect(page.getByText("Try again or log it manually.")).toBeVisible();
  await page.getByRole("link", { name: "Search for food" }).click();
  await expect(page.getByRole("searchbox", { name: "Search local foods" })).toBeVisible();

  await page.goto("/settings/catalogs");
  await off.getByRole("button", { name: "Remove" }).click();
  await expect(off).toContainText("Disable barcode scanning for everyone?");
  await off.getByRole("button", { name: "Disable scanning" }).click();
  await expect(off).toContainText("○ Not configured");

  const memberContext = await browser.newContext({ baseURL: new URL(page.url()).origin, ignoreHTTPSErrors: true });
  try {
    const member = await memberContext.newPage();
    await signInProvisionedMember(member, "barcode.setup.member", validPassword);
    await member.getByRole("button", { name: "Finish setup" }).click();
    await member.getByRole("button", { name: "Add Food" }).click();
    const methods = member.getByLabel("Add Food methods");
    await expect(methods.getByRole("link", { name: "Manual" })).toBeVisible();
    await expect(methods.getByText("Scan barcode")).toHaveCount(0);
    await member.goto("/?date=2026-08-29&food=barcode&barcode=034000470693");
    await expect(member).toHaveURL("/?date=2026-08-29&food=choose");
  } finally {
    await memberContext.close();
  }
});

test("an authenticated user can add, reset, and later rescale a manual Food Entry", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.96" });
  await completeSetupForTestUser(page, "food.entry.manual");
  await page.goto("/?date=2026-08-28&food=manual");

  let dialog = page.getByRole("dialog", { name: "Add Food" });
  await expect(page.getByLabel("Food name")).toBeFocused();
  await dialog.getByRole("link", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Add Food" })).toBeFocused();

  await page.getByRole("button", { name: "Add Food" }).click();
  await page.getByRole("link", { name: /Manual/ }).click();
  dialog = page.getByRole("dialog", { name: "Add Food" });
  await expect(dialog.getByRole("heading", { name: "Add food manually" }))
    .toBeVisible();
  await expect(page.getByLabel("Food name")).toBeFocused();
  await expect(dialog.getByText("1 serving", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Quantity")).toHaveValue("1");

  await page.getByLabel("Food name").fill("Discarded tortilla");
  await page.getByLabel("Calories (kcal)").fill("60");
  await dialog.getByRole("link", { name: "Back to methods" }).click();
  await page.getByRole("link", { name: /Manual/ }).click();
  await expect(page.getByLabel("Food name")).toBeFocused();
  await expect(page.getByLabel("Food name")).toHaveValue("");
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("");

  await page.getByLabel("Food name").fill("Cancelled tortilla");
  await page.getByLabel("Calories (kcal)").fill("60");
  await dialog.getByRole("link", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Add Food" }).click();
  await page.getByRole("link", { name: /Manual/ }).click();
  await expect(page.getByLabel("Food name")).toHaveValue("");
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("");
  await expect(page.getByLabel("Quantity")).toHaveValue("1");

  await page.getByLabel("Food name").fill("Tortillas");
  await page.getByLabel("Quantity").fill("3");
  const addManualFood = dialog.getByRole("button", {
    name: "Add to Food Log",
  });
  await addManualFood.click();
  await expect(dialog.getByRole("alert")).toContainText("calories");
  await expect(page.getByLabel("Food name")).not.toBeFocused();
  await expect(page.getByLabel("Food name")).toHaveValue("Tortillas");
  await expect(page.getByLabel("Quantity")).toHaveValue("3");

  await page.getByLabel("Calories (kcal)").fill("180");
  await page.getByLabel("Protein (g)").fill("6");
  await page.getByLabel("Carbohydrate (g)").fill("36");
  await page.getByLabel("Fat (g)").fill("3");
  await page.getByLabel("Fiber (g)").fill("4");
  await page.getByLabel("Sugar (g)").fill("1");
  await page.getByLabel("Sodium (mg)").fill("30");
  await page.getByLabel("Quantity").fill("4");
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("180");
  await expect(page.getByLabel("Protein (g)")).toHaveValue("6");
  await page.getByLabel("Quantity").fill("3");

  const accessibilityScan = await new AxeBuilder({ page }).analyze();
  expect(accessibilityScan.violations).toEqual([]);
  await dialog.getByRole("button", { name: "Add to Food Log" }).click();
  await expect(page).toHaveURL("/?date=2026-08-28");
  const saved = page.getByRole("article").filter({ hasText: "Tortillas" });
  await expect(saved).toContainText("Manual");
  await expect(saved).toContainText("1 serving × 3");
  await expect(saved).toContainText("180 kcal");

  await saved.getByRole("link").click();
  await page.getByLabel("Quantity").fill("4");
  await expect(page.getByLabel("Calories (kcal)")).toHaveValue("240");
  await expect(page.getByLabel("Protein (g)")).toHaveValue("8");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL("/?date=2026-08-28");

  const expectUpdatedLog = async () => {
    await expect(page.getByRole("heading", {
      name: "Food Log for Friday, August 28, 2026",
    })).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Edit Food Entry" })).toHaveCount(0);
    await expect(page.getByRole("status")).toHaveCount(0);
    await expect(saved).toContainText("1 serving × 4");
    await expect(saved).toContainText("240 kcal");
    await expect(page.getByRole("region", { name: "Calories" })).toContainText("240");
    await expect(page.getByRole("article", { name: /^Protein: 8 / })).toBeVisible();
  };
  await expectUpdatedLog();
  await page.reload();
  await expectUpdatedLog();
  await page.goto("/?date=2026-08-28&notice=updated");
  await expectUpdatedLog();
  await page.reload();
  await expectUpdatedLog();
});

test("@camera-matrix simulated scan stays local and follows review before one snapshot", async ({
  context,
  page,
}, testInfo) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.94" });
  await installSimulatedBarcodeCamera(page);
  configureBarcodeContact();
  await completeSetupForTestUser(page, `camera.${testInfo.project.name}`);

  const transmittedPayloads: string[] = [];
  page.on("request", (request) => {
    const body = request.postData();
    if (body) transmittedPayloads.push(body);
  });

  await page.getByRole("button", { name: "Add Food" }).click();
  await page.getByRole("link", { name: /Scan barcode/ }).click();
  const barcodeInput = page.getByLabel("Enter barcode");
  await expect(barcodeInput).toBeVisible();
  await page.getByRole("button", { name: "Use camera" }).click();
  await expect(page.getByText("Point the camera at the barcode")).toBeVisible();
  await expect(page.getByLabel("Live barcode camera preview")).toBeVisible();
  await expect(barcodeInput).toBeVisible();
  expect(await page.evaluate(() => (
    window as typeof window & {
      __scannerState: { constraints?: MediaStreamConstraints };
    }
  ).__scannerState.constraints)).toEqual({
    audio: false,
    video: {
      facingMode: { ideal: "environment" },
      frameRate: { ideal: 30 },
      height: { ideal: 1080 },
      width: { ideal: 1920 },
    },
  });
  await expect(page.getByRole("button", { name: "Turn light on" })).toBeVisible();
  await expect(page.getByRole("slider", { name: "Camera zoom" })).toHaveCount(0);
  expect(await page.evaluate(() => (
    window as typeof window & {
      __scannerState: { appliedConstraints: MediaTrackConstraints[] };
    }
  ).__scannerState.appliedConstraints)).toEqual([
    { advanced: [{ focusMode: "continuous", zoom: 1.5 }] },
  ]);
  await page.getByRole("button", { name: "Turn light on" }).click();
  await expect(page.getByRole("button", { name: "Turn light off" })).toBeVisible();
  await expectCatalogResponsive(page);
  const activeCameraAxe = await new AxeBuilder({ page }).analyze();
  expect(activeCameraAxe.violations).toEqual([]);

  let releaseLookup!: () => void;
  const lookupGate = new Promise<void>((resolve) => {
    releaseLookup = resolve;
  });
  let lookupRequests = 0;
  await page.route(/(?=.*[?&]food=barcode)(?=.*[?&]barcode=034000470693)/, async (route) => {
    lookupRequests += 1;
    await lookupGate;
    await route.continue();
  }, { times: 1 });

  await page.evaluate(() => {
    (
      window as typeof window & { __scannerState: { emit: boolean } }
    ).__scannerState.emit = true;
  });
  await expect(page.getByText("Recognized 034000470693")).toBeVisible();
  await expect(barcodeInput).toHaveValue("034000470693");
  await expect(page.getByLabel("Live barcode camera preview")).toBeHidden();
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & {
      __scannerState: { trackStops: number };
    }
  ).__scannerState.trackStops)).toBe(1);
  expect(lookupRequests).toBe(1);
  releaseLookup();

  await expect(page.getByRole("heading", { name: "Example cereal" })).toBeVisible();
  await expect(barcodeInput).toBeHidden();
  await expect(page.getByRole("link", { name: "Back to scanner" })).toBeVisible();
  await expect(page.getByText("Barcode 0034000470693")).toBeVisible();
  await expect(page.getByLabel("Measurement", { exact: true })).toHaveValue("serving");
  await expect(page.getByText("180 kcal")).toBeVisible();
  await expect(page.getByText("24 g")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Food Facts" })).toBeVisible();
  const quantity = page.getByLabel("Quantity");
  await quantity.fill("0.5");
  await expect(page.getByText("90 kcal")).toBeVisible();
  await expect(page.getByText("12 g")).toBeVisible();
  await expect(page.getByText("No entries for this day")).toBeVisible();

  await page.getByRole("button", { name: "Add to Food Log" }).click();
  const savedEntry = page.getByRole("article").filter({ hasText: "Example cereal" });
  await expect(savedEntry).toHaveCount(1);
  await expect(savedEntry).toContainText("Open Food Facts");
  await expect(savedEntry).toContainText("1 serving (30 g) × 0.5");
  await expect(savedEntry).toContainText("90 kcal");
  expect(transmittedPayloads.join("\n")).not.toMatch(
    /(?:blob:|data:image|frame|photograph|photo=)/i,
  );
  await expect(page.locator("img")).toHaveCount(0);

  await page.evaluate(() => {
    (
      window as typeof window & {
        __scannerState: { barcode: string; emit: boolean };
      }
    ).__scannerState.barcode = "0000000000048";
    (
      window as typeof window & { __scannerState: { emit: boolean } }
    ).__scannerState.emit = false;
  });
  await page.getByRole("button", { name: "Add Food" }).click();
  await page.getByRole("link", { name: /Scan barcode/ }).click();
  await page.getByRole("button", { name: "Use camera" }).click();
  await expect(page.getByText("Point the camera at the barcode")).toBeVisible();
  await page.evaluate(() => {
    (
      window as typeof window & { __scannerState: { emit: boolean } }
    ).__scannerState.emit = true;
  });
  await expect(
    page.getByRole("heading", { name: "Open Food Facts isn't responding" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(page.getByLabel("Enter barcode")).toBeVisible();
  await expect(page.getByRole("link", { name: "Search for food" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Use camera" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & {
      __scannerState: { trackStops: number };
    }
  ).__scannerState.trackStops)).toBe(2);

  await page.evaluate(() => {
    (
      window as typeof window & { __scannerState: { emit: boolean } }
    ).__scannerState.emit = false;
  });
  await page.getByRole("button", { name: "Use camera" }).click();
  await expect(page.getByText("Point the camera at the barcode")).toBeVisible();
  let releaseSearch!: () => void;
  const searchGate = new Promise<void>((resolve) => {
    releaseSearch = resolve;
  });
  await page.route(/(?=.*[?&]food=search)/, async (route) => {
    await searchGate;
    await route.continue();
  }, { times: 1 });
  await page.getByRole("link", { name: "Search for food" }).click();
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & {
      __scannerState: { trackStops: number };
    }
  ).__scannerState.trackStops)).toBe(3);
  const blockedCameraButton = page.getByRole("button", { name: "Use camera" });
  await expect(blockedCameraButton).toBeDisabled();
  await blockedCameraButton.evaluate((button) => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  expect(await page.evaluate(() => (
    window as typeof window & {
      __scannerState: { cameraStarts: number };
    }
  ).__scannerState.cameraStarts)).toBe(3);
  releaseSearch();
  await expect(
    page.getByRole("searchbox", { name: "Search local foods" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Add Food" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Add Food" })).toBeFocused();

  await page.getByRole("button", { name: "Add Food" }).click();
  await page.getByRole("link", { name: /Scan barcode/ }).click();
  await page.getByRole("button", { name: "Use camera" }).click();
  await expect(page.getByText("Point the camera at the barcode")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog", { name: "Add Food" })).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => (
    window as typeof window & {
      __scannerState: { trackStops: number };
    }
  ).__scannerState.trackStops)).toBe(4);
  await expect(page.getByRole("button", { name: "Add Food" })).toBeFocused();
});

test("food selection immediately reveals the pending detail destination", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.91" });
  await completeSetupForTestUser(page, "catalog.pending-destinations");

  await openUsdaSearch(page);
  await page
    .getByRole("searchbox", { name: "Search local foods" })
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
    page.getByRole("searchbox", { name: "Search local foods" }),
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
  await completeSetupForTestUser(page, "catalog.pending-log");

  await openUsdaSearch(page);
  await page
    .getByRole("searchbox", { name: "Search local foods" })
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
      request.postData()?.includes("method=lookup")
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

test("Food Entry deletion reveals its confirmation on narrow displays", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.97" });
  await completeSetupForTestUser(page, "food.entry.mobile-delete");
  await openUsdaSearch(page);
  await page
    .getByRole("searchbox", { name: "Search local foods" })
    .fill("yogurt");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("link", { name: /Plain nonfat Greek yogurt/ }).click();
  await page.getByRole("button", { name: "Add to Food Log" }).click();

  await page.setViewportSize({ height: 844, width: 390 });
  await page
    .getByRole("link", { name: /Plain nonfat Greek yogurt.*100\.3 kcal/ })
    .click();
  const editor = page.getByRole("dialog", { name: "Edit Food Entry" });
  await editor.getByRole("button", { name: "Delete entry" }).click();

  const confirmDelete = editor.getByRole("button", {
    name: "Delete",
    exact: true,
  });
  await expect(confirmDelete).toBeInViewport();
  await expect(confirmDelete).toBeFocused();
  await confirmDelete.click();
  await expect(page).toHaveURL(/date=2026-08-29&notice=deleted/);
  await expect(page.getByText("No entries for this day")).toBeVisible();
});

test("an authenticated user can correct and delete one Food Entry", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.83" });
  await completeSetupForTestUser(page, "food.entry.edit");
  await openUsdaSearch(page);
  await page
    .getByRole("searchbox", { name: "Search local foods" })
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
    "Enter a food name of 1 to 200 characters.",
  );
  await expectFoodEntryEditorResponsive(page);
  await expect(editor.getByRole("alert")).toContainText(
    "Enter a food name of 1 to 200 characters.",
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
    fields.intent = "update";
    return fields;
  });
  const malformedStatus = await page.evaluate(async (fields) => {
    const body = new URLSearchParams(fields as Record<string, string>);
    body.set("measurementId", "invented-measurement");
    const response = await fetch("/food-events", {
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
  await expect(page.getByRole("button", { name: "Saving changes" })).toBeDisabled();
  await expectFoodEntryEditorResponsive(page);
  await expect(page.getByRole("button", { name: "Saving changes" })).toBeDisabled();
  releaseUpdate();
  await saveClick;
  await page.unroute("**/*", delayUpdate);
  await expect(page).toHaveURL("/?date=2026-08-29");
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(page.getByText("Breakfast yogurt", { exact: true })).toBeVisible();
  await expect(page.getByText("29.5 kcal", { exact: true })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Calorie progress" }))
    .toHaveAttribute("aria-valuenow", "29.5");

  const database = openBrowserTestDatabase();
  const persisted = database
    .prepare(
      `SELECT
       authoritative_nutrition AS authoritativeNutrition,
        authoritative_carbohydrate_milligrams AS carbohydrateMilligrams,
        authoritative_fat_milligrams AS fatMilligrams
       FROM food_events f
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
    const response = await fetch("/food-events", {
      body: new URLSearchParams(fields as Record<string, string>),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
    });
    return response.status;
  }, editFields);
  expect(staleStatus).toBe(409);

  const entryId = String(editFields.id);
  const otherContext = await page.context().browser()!.newContext();
  await otherContext.setExtraHTTPHeaders({
    "X-Test-Client-IP": "203.0.113.84",
  });
  const otherPage = await otherContext.newPage();
  await completeSetupForTestUser(otherPage, "food.entry.other");
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
      const submit = (intent: "delete" | "update") =>
        fetch("/food-events", {
          body: new URLSearchParams({
            carbohydrateGrams: "",
            csrfToken,
            date: "2026-08-29",
            energyKcal: "",
            expectedUpdatedAt,
            fatGrams: "",
            fiberGrams: "",
            id: entryId,
            intent,
            measurementId: "base:g:100000000",
            name: "Unavailable",
            proteinGrams: "",
            quantity: "1",
            sodiumMilligrams: "",
            sugarGrams: "",
          }),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          method: "POST",
        });
      const update = await submit("update");
      const deletion = await submit("delete");
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

test("an authenticated user can copy a historical Food Entry to today", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.89" });
  await completeSetupForTestUser(page, "food.entry.copy");
  await page.goto("/?date=2026-08-28");
  await openUsdaSearch(page);
  await page
    .getByRole("searchbox", { name: "Search local foods" })
    .fill("yogurt");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("link", { name: /Plain nonfat Greek yogurt/ }).click();
  await page.getByRole("button", { name: "Add to Food Log" }).click();

  await page.getByRole("button", { name: "Add Water" }).click();
  const waterDialog = page.getByRole("dialog", { name: "Add Water" });
  await fillSteadily(waterDialog.getByLabel("Amount (fl oz)"), "8");
  await waterDialog.getByRole("button", { name: "Add water", exact: true }).click();
  await expect(waterDialog).not.toBeVisible();

  const sourceCard = page.getByRole("link", {
    name: /Plain nonfat Greek yogurt.*100\.3 kcal/,
  });
  await sourceCard.click();
  const sourceEditor = page.getByRole("dialog", { name: "Edit Food Entry" });
  await expect(sourceEditor).toBeVisible();
  await expect(sourceEditor.getByLabel("Food name")).toHaveValue(
    "Plain nonfat Greek yogurt",
  );
  await expect(sourceEditor.getByLabel("Quantity")).toHaveValue("1");
  await expect(sourceEditor.getByLabel("Calories (kcal)")).toHaveValue("100.3");
  const sourceMeasurements = await sourceEditor
    .getByLabel("Measurement")
    .locator("option")
    .evaluateAll((options) =>
      options.map((option) => ({
        label: option.textContent,
        value: (option as HTMLOptionElement).value,
      })),
    );
  await sourceEditor.getByLabel("Food name").fill("Reusable yogurt");
  await sourceEditor.getByLabel("Quantity").fill("1.25");
  await sourceEditor.getByLabel("Calories (kcal)").fill("111.111");
  await sourceEditor.getByLabel("Protein (g)").fill("22.222");
  await sourceEditor.getByLabel("Carbohydrate (g)").fill("33.333");
  await sourceEditor.getByLabel("Fat (g)").fill("4.444");
  await sourceEditor.getByLabel("Fiber (g)").fill("");
  await sourceEditor.getByLabel("Sugar (g)").fill("5.555");
  await sourceEditor.getByLabel("Sodium (mg)").fill("666");
  await sourceEditor.getByRole("button", { name: "Save changes" }).click();
  const correctedSourceCard = page.getByRole("link", {
    name: /Reusable yogurt.*USDA FoodData Central · Branded.*111\.1 kcal/,
  });
  await expect(correctedSourceCard).toBeVisible();

  await correctedSourceCard.click();
  const editor = page.getByRole("dialog", { name: "Edit Food Entry" });
  const menuTrigger = editor.getByRole("button", { name: "Copy entry" });
  await expect(menuTrigger).toBeVisible();
  await expect(page.getByRole("button", { name: /More actions for/ })).toHaveCount(0);
  await menuTrigger.click();
  const copyButton = editor.getByRole("button", { name: "Copy to today" });
  await expect(copyButton).toBeVisible();
  expect(await postedFields(copyButton)).toEqual({ date: "2026-08-28", id: expect.stringMatching(/^[1-9]\d*$/) as unknown as string, intent: "copy" });
  const openMenuAccessibility = await new AxeBuilder({ page }).analyze();
  expect(openMenuAccessibility.violations).toEqual([]);

  let releaseCopy!: () => void;
  let signalCopyStarted!: () => void;
  const copyGate = new Promise<void>((resolve) => {
    releaseCopy = resolve;
  });
  const copyStarted = new Promise<void>((resolve) => {
    signalCopyStarted = resolve;
  });
  await page.route("**/*", async (route) => {
    if (
      route.request().method() === "POST" &&
      route.request().postData()?.includes("intent=copy") &&
      !route.request().postData()?.includes("destinationDate")
    ) {
      signalCopyStarted();
      await copyGate;
    }
    await route.continue();
  });
  const submission = copyButton.click();
  await copyStarted;
  await expect(page.getByRole("button", { name: "Copying…" })).toBeDisabled();
  await expect(page).toHaveURL(/date=2026-08-28/);
  releaseCopy();
  await submission;
  await page.unroute("**/*");

  await expect(page).toHaveURL(
    /date=2026-08-28&notice=copied&copied=[1-9]\d*/,
  );
  await expect(page.getByRole("status")).toContainText(
    "Copied Reusable yogurt to today's Food Log.",
  );
  await expect(correctedSourceCard).toBeVisible();
  await expect(
    page.locator("[data-water-editor-trigger]").filter({ hasText: "8 fl oz" }),
  ).toBeVisible();
  await expect(
    page.getByRole("progressbar", { name: "Calorie progress" }),
  ).toHaveAttribute("aria-valuetext", /111\.1 of 2,050 kcal target/);

  await page.goto("/");
  const copiedCard = page.getByRole("link", {
    name: /Reusable yogurt.*USDA FoodData Central · Branded.*111\.1 kcal/,
  });
  await expect(copiedCard).toBeVisible();
  await expect(
    page.getByRole("progressbar", { name: "Calorie progress" }),
  ).toHaveAttribute("aria-valuetext", /111\.1 of 2,050 kcal target/);
  await copiedCard.click();
  const copiedEditor = page.getByRole("dialog", { name: "Edit Food Entry" });
  await expect(copiedEditor.getByRole("button", { name: "Copy entry" })).toHaveCount(0);
  await expect(copiedEditor.getByLabel("Food name")).toHaveValue(
    "Reusable yogurt",
  );
  await expect(copiedEditor.getByLabel("Measurement")).toHaveValue(
    "serving:g:170000000",
  );
  await expect(copiedEditor.getByLabel("Quantity")).toHaveValue("1.25");
  await expect(copiedEditor.getByLabel("Calories (kcal)")).toHaveValue(
    "111.111",
  );
  await expect(copiedEditor.getByLabel("Protein (g)")).toHaveValue("22.222");
  await expect(copiedEditor.getByLabel("Carbohydrate (g)")).toHaveValue(
    "33.333",
  );
  await expect(copiedEditor.getByLabel("Fat (g)")).toHaveValue("4.444");
  await expect(copiedEditor.getByLabel("Fiber (g)")).toHaveValue("");
  await expect(copiedEditor.getByLabel("Sugar (g)")).toHaveValue("5.555");
  await expect(copiedEditor.getByLabel("Sodium (mg)")).toHaveValue("666");
  expect(
    await copiedEditor
      .getByLabel("Measurement")
      .locator("option")
      .evaluateAll((options) =>
        options.map((option) => ({
          label: option.textContent,
          value: (option as HTMLOptionElement).value,
        })),
      ),
  ).toEqual(sourceMeasurements);
  await expect(copiedEditor.getByRole("button", { name: "Delete entry" }))
    .toBeVisible();
  await copiedEditor.getByLabel("Food name").fill("Independent copied yogurt");
  await copiedEditor.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByText("Independent copied yogurt", { exact: true }),
  ).toBeVisible();
  await page.goto("/?date=2026-08-28");
  await expect(correctedSourceCard).toBeVisible();
  await expect(
    page.getByText("Independent copied yogurt", { exact: true }),
  ).toHaveCount(0);

  const accessibilityScan = await new AxeBuilder({ page }).analyze();
  expect(accessibilityScan.violations).toEqual([]);
});

test("an authenticated user can review and copy a Food Entry to another eligible date", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.90" });
  await completeSetupForTestUser(page, "food.entry.copy-date");

  await page.goto("/?date=2026-08-27");
  await page.getByRole("button", { name: "Add Water" }).click();
  const waterDialog = page.getByRole("dialog", { name: "Add Water" });
  await fillSteadily(waterDialog.getByLabel("Amount (fl oz)"), "8");
  await waterDialog.getByRole("button", { name: "Add water", exact: true }).click();
  await expect(waterDialog).not.toBeVisible();

  await expect(
    page.locator("[data-water-editor-trigger]").filter({ hasText: "8 fl oz" }),
  ).toBeVisible();

  await page.goto("/?date=2026-08-26");
  await openUsdaSearch(page);
  await page
    .getByRole("searchbox", { name: "Search local foods" })
    .fill("yogurt");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("link", { name: /Plain nonfat Greek yogurt/ }).click();
  await page.getByRole("button", { name: "Add to Food Log" }).click();

  await page.getByRole("link", {
    name: /Plain nonfat Greek yogurt.*100\.3 kcal/,
  }).click();
  const menuTrigger = page.getByRole("dialog", { name: "Edit Food Entry" })
    .getByRole("button", { name: "Copy entry" });
  await menuTrigger.click();
  await expect(page.getByRole("button", { name: "Copy to today" })).toBeVisible();
  const copyToDateLink = page.getByRole("link", {
    name: "Copy to another date…",
  });
  await expect(copyToDateLink).toBeVisible();
  await copyToDateLink.click();

  let dialog = page.getByRole("dialog", {
    name: "Copy Plain nonfat Greek yogurt",
  });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Copy", exact: true }))
    .toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Wednesday, August 26" }))
    .toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Sunday, August 30" }))
    .toBeDisabled();
  await expect(dialog.getByRole("link", { name: "Saturday, August 29" }))
    .toBeVisible();
  for (const viewport of [
    { height: 844, width: 390 },
    { height: 900, width: 800 },
    { height: 900, width: 1_120 },
  ]) {
    await page.setViewportSize(viewport);
    await expect(dialog).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  }
  await page.setViewportSize({ height: 720, width: 1_280 });
  const openDialogAccessibility = await new AxeBuilder({ page }).analyze();
  expect(openDialogAccessibility.violations).toEqual([]);

  await dialog.getByRole("link", { name: "Cancel" }).click();
  await expect(page).toHaveURL("/?date=2026-08-26");
  await expect(page.getByRole("link", {
    name: /Plain nonfat Greek yogurt.*100\.3 kcal/,
  })).toBeFocused();
  await expect(
    page.getByRole("link", { name: /Plain nonfat Greek yogurt.*100\.3 kcal/ }),
  ).toHaveCount(1);

  await page.getByRole("link", {
    name: /Plain nonfat Greek yogurt.*100\.3 kcal/,
  }).click();
  await page.getByRole("dialog", { name: "Edit Food Entry" })
    .getByRole("button", { name: "Copy entry" }).click();
  await page.getByRole("link", { name: "Copy to another date…" }).click();
  dialog = page.getByRole("dialog", {
    name: "Copy Plain nonfat Greek yogurt",
  });
  await dialog.getByRole("link", { name: "Thursday, August 27" }).click();
  await expect(dialog.getByText("Thursday, August 27, 2026", { exact: true }))
    .toBeVisible();

  const destinationPreview = await context.newPage();
  await destinationPreview.goto("/?date=2026-08-27");
  await expect(
    destinationPreview.getByRole("link", {
      name: /Plain nonfat Greek yogurt.*100\.3 kcal/,
    }),
  ).toHaveCount(0);
  await destinationPreview.close();

  let releaseCopy!: () => void;
  let signalCopyStarted!: () => void;
  const copyGate = new Promise<void>((resolve) => {
    releaseCopy = resolve;
  });
  const copyStarted = new Promise<void>((resolve) => {
    signalCopyStarted = resolve;
  });
  await page.route("**/*", async (route) => {
    if (
      route.request().method() === "POST" &&
      route.request().postData()?.includes("intent=copy") &&
      route.request().postData()?.includes("destinationDate=2026-08-27")
    ) {
      signalCopyStarted();
      await copyGate;
    }
    await route.continue();
  });
  const copyButton = dialog.getByRole("button", { name: "Copy", exact: true });
  const submission = copyButton.click();
  await copyStarted;
  await expect(dialog.getByRole("button", { name: "Copying…" })).toBeDisabled();
  releaseCopy();
  await submission;
  await page.unroute("**/*");

  await expect(page).toHaveURL(
    /date=2026-08-26&notice=copied&copied=[1-9]\d*/,
  );
  await expect(page.getByRole("status")).toContainText(
    "Copied Plain nonfat Greek yogurt to Thursday, August 27, 2026.",
  );
  await expect(
    page.getByRole("link", { name: /Plain nonfat Greek yogurt.*100\.3 kcal/ }),
  ).toHaveCount(1);

  await page.goto("/?date=2026-08-27");
  let copiedCards = page.getByRole("link", {
    name: /Plain nonfat Greek yogurt.*100\.3 kcal/,
  });
  await expect(copiedCards).toHaveCount(1);
  await expect(copiedCards.locator("time")).toHaveText("12:00 PM");
  await expect(
    page.locator("[data-water-editor-trigger]").filter({ hasText: "8 fl oz" }),
  ).toBeVisible();
  await expect(
    page.getByRole("progressbar", { name: "Calorie progress" }),
  ).toHaveAttribute("aria-valuetext", /100\.3 of 2,050 kcal target/);

  await page.goto("/?date=2026-08-26");
  await page.getByRole("link", {
    name: /Plain nonfat Greek yogurt.*100\.3 kcal/,
  }).click();
  await page.getByRole("dialog", { name: "Edit Food Entry" })
    .getByRole("button", { name: "Copy entry" }).click();
  await page.getByRole("link", { name: "Copy to another date…" }).click();
  dialog = page.getByRole("dialog", {
    name: "Copy Plain nonfat Greek yogurt",
  });
  await dialog.getByRole("link", { name: "Thursday, August 27" }).click();
  await dialog.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "Copied Plain nonfat Greek yogurt to Thursday, August 27, 2026.",
  );
  await page.goto("/?date=2026-08-27");
  copiedCards = page.getByRole("link", {
    name: /Plain nonfat Greek yogurt.*100\.3 kcal/,
  });
  // Every copy to a past day lands at noon; the newer copy is listed first.
  await expect(copiedCards).toHaveCount(2);
  await expect(copiedCards.nth(0).locator("time")).toHaveText("12:00 PM");
  await expect(copiedCards.nth(1).locator("time")).toHaveText("12:00 PM");
  await expect(
    page.getByRole("progressbar", { name: "Calorie progress" }),
  ).toHaveAttribute("aria-valuetext", /200\.6 of 2,050 kcal target/);

  await page.goto("/?date=2026-08-26");
  await page.getByRole("link", {
    name: /Plain nonfat Greek yogurt.*100\.3 kcal/,
  }).click();
  await page.getByRole("dialog", { name: "Edit Food Entry" })
    .getByRole("button", { name: "Copy entry" }).click();
  await page.getByRole("link", { name: "Copy to another date…" }).click();
  dialog = page.getByRole("dialog", {
    name: "Copy Plain nonfat Greek yogurt",
  });
  await dialog.getByRole("link", { name: "Saturday, August 29" }).click();
  await dialog.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "Copied Plain nonfat Greek yogurt to today's Food Log.",
  );
  await page.goto("/");
  const todayCopy = page.getByRole("link", {
    name: /Plain nonfat Greek yogurt.*100\.3 kcal/,
  });
  await expect(todayCopy).toHaveCount(1);
  await expect(todayCopy.locator("time")).toHaveText("2:00 PM");
  const accessibilityScan = await new AxeBuilder({ page }).analyze();
  expect(accessibilityScan.violations).toEqual([]);
});

for (const width of [390, 430]) {
  test(`historical Food Entry actions are visible at the top of the editor at ${width}×844`, async ({
    context,
    page,
  }) => {
    await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.91" });
    await page.setViewportSize({ height: 844, width });
    await completeSetupForTestUser(
      page,
      `food.entry.copy-menu-mobile.${width}`,
    );
    await page.goto("/?date=2026-08-28");
    await openUsdaSearch(page);
    await page
      .getByRole("searchbox", { name: "Search local foods" })
      .fill("yogurt");
    await page.getByRole("button", { name: "Search" }).click();
    await page.getByRole("link", { name: /Plain nonfat Greek yogurt/ }).click();
    await page.getByRole("button", { name: "Add to Food Log" }).click();

    await page.getByRole("link", {
      name: /Plain nonfat Greek yogurt.*100\.3 kcal/,
    }).click();
    const editor = page.getByRole("dialog", { name: "Edit Food Entry" });
    const copyTrigger = editor.getByRole("button", { name: "Copy entry" });
    const deleteTrigger = editor.getByRole("button", { name: "Delete entry" });
    const save = editor.getByRole("button", { name: "Save changes" });
    const cancel = editor.getByRole("link", { name: "Cancel" });
    const titleBounds = await editor.getByRole("heading", { name: "Edit Food Entry" }).boundingBox();
    expect(titleBounds).not.toBeNull();
    for (const action of [copyTrigger, deleteTrigger, save, cancel]) {
      await expect(action).toBeVisible();
      const bounds = await action.boundingBox();
      expect(bounds).not.toBeNull();
      expect(bounds!.y - titleBounds!.y).toBeLessThan(110);
      expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    }
    const saveBounds = await save.boundingBox();
    expect(saveBounds).not.toBeNull();
    expect(width - (saveBounds!.x + saveBounds!.width)).toBeLessThanOrEqual(20);
    await editor.evaluate((element) => { element.scrollTop = element.scrollHeight; });
    const scrolledCopyBounds = await copyTrigger.boundingBox();
    expect(scrolledCopyBounds).not.toBeNull();
    expect(scrolledCopyBounds!.y).toBeGreaterThanOrEqual(0);
    expect(scrolledCopyBounds!.y + scrolledCopyBounds!.height).toBeLessThan(844);
    await copyTrigger.click();
    const copyToDate = editor.getByRole("link", {
      name: "Copy to another date…",
    });
    const mobileNavigation = page.getByRole("navigation", {
      name: "Primary navigation",
    });
    await expect(copyToDate).toBeVisible();
    await expect(mobileNavigation).toBeVisible();
    const copyBounds = await copyToDate.boundingBox();
    const navigationBounds = await mobileNavigation.boundingBox();
    expect(copyBounds).not.toBeNull();
    expect(navigationBounds).not.toBeNull();
    expect(copyBounds!.y + copyBounds!.height).toBeLessThanOrEqual(
      navigationBounds!.y,
    );
    expect(
      await copyToDate.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const hit = document.elementFromPoint(
          bounds.left + bounds.width / 2,
          bounds.bottom - 2,
        );
        return hit === element || element.contains(hit);
      }),
    ).toBe(true);

    await copyToDate.click();
    await expect(
      page.getByRole("dialog", { name: "Copy Plain nonfat Greek yogurt" }),
    ).toBeVisible();
    await expect(page).not.toHaveURL(/\/settings\/goals/);
  });
}

test("a stale Food Entry editor refreshes to the current occurrence and can retry", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.85" });
  await completeSetupForTestUser(page, "food.entry.stale-recovery");
  await openUsdaSearch(page);
  await page
    .getByRole("searchbox", { name: "Search local foods" })
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
      fields.intent = "update";
      fields.name = "Updated elsewhere";
      const response = await fetch("/food-events", {
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
  await expect(page).toHaveURL("/?date=2026-08-29");
  await expect(editor).toHaveCount(0);
  await expect(page.getByRole("status")).toHaveCount(0);
  await expect(
    page.getByText("Updated elsewhere", { exact: true }),
  ).toBeVisible();
});

test("delete pending state names only the destructive mutation", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.86" });
  await completeSetupForTestUser(page, "food.entry.delete-pending");
  await openUsdaSearch(page);
  await page
    .getByRole("searchbox", { name: "Search local foods" })
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
    await expect(page.getByRole("button", { name: "Saving changes" })).toHaveCount(0);
  } finally {
    releaseDelete();
  }
  await deleteClick;
  await page.unroute("**/*", delayDelete);
  await expect(page).toHaveURL(/date=2026-08-29&notice=deleted/);
});
