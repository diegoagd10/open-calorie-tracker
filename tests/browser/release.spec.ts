import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import {
  bootstrapOrSignInBrowserTestUser,
  expect,
  openBrowserTestDatabase,
  test,
} from "./reset-database";

const validPassword = "correct horse 🔐 battery";

async function expectNoSeriousAxeViolations(page: Page) {
  const scan = await new AxeBuilder({ page }).analyze();
  expect(
    scan.violations.filter(
      (violation) =>
        violation.impact === "serious" || violation.impact === "critical",
    ),
  ).toEqual([]);
}

async function completeSetupForTestUser(
  page: Page,
  username: string,
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
}
async function csrfTokenFor(page: Page, buttonName: "Add Food" | "Add Water") {
  return page
    .locator("form")
    .filter({ has: page.getByRole("button", { name: buttonName }) })
    .locator('input[name="csrfToken"]')
    .inputValue();
}

async function tabTo(page: Page, target: Locator) {
  await expect(target).toBeVisible({ timeout: 5_000 });
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (
      await target.evaluate(
        (element) => element === document.activeElement,
      ).catch(() => false)
    ) {
      await expect(target).toBeFocused();
      expect(await target.evaluate((element) => element.matches(":focus-visible"))).toBe(
        true,
      );
      return;
    }
    await page.keyboard.press("Tab");
  }
  throw new Error(`keyboard focus did not reach ${target.toString()}`);
}

async function expectMobileReflowAndTargets(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(
    await page.evaluate(() =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          'a, button, input:not([type="hidden"]):not([type="radio"]), select',
        ),
      )
        .filter((element) => {
          const style = getComputedStyle(element);
          const bounds = element.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            bounds.width > 0 &&
            bounds.height > 0
          );
        })
        .filter((element) => {
          const bounds = element.getBoundingClientRect();
          return bounds.width < 24 || bounds.height < 24;
        })
        .map((element) => element.outerHTML),
    ),
  ).toEqual([]);
}

test("mobile metadata supports adding the app to an iPhone Home Screen", async ({
  page,
  request,
}) => {
  await page.goto("/login");

  await expect(page.locator('html[lang="en"]')).toHaveCount(1);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    "href",
    "/manifest.webmanifest",
  );
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
    "href",
    "/favicon.png",
  );
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute(
    "href",
    "/apple-touch-icon.png",
  );
  await expect(
    page.locator('meta[name="apple-mobile-web-app-capable"]'),
  ).toHaveAttribute("content", "yes");
  await expect(
    page.locator('meta[name="apple-mobile-web-app-title"]'),
  ).toHaveAttribute("content", "Open Calorie Tracker");

  const manifestResponse = await request.get("/manifest.webmanifest");
  expect(manifestResponse.status()).toBe(200);
  await expect(manifestResponse.json()).resolves.toMatchObject({
    icons: [
      {
        purpose: "any",
        sizes: "192x192",
        src: "/icons/app-icon-192.png",
        type: "image/png",
      },
      {
        purpose: "any",
        sizes: "512x512",
        src: "/icons/app-icon-512.png",
        type: "image/png",
      },
    ],
    id: "/",
    scope: "/",
    start_url: "/",
  });

  for (const iconPath of [
    "/favicon.png",
    "/apple-touch-icon.png",
    "/icons/app-icon-192.png",
    "/icons/app-icon-512.png",
  ]) {
    const iconResponse = await request.get(iconPath);
    expect(iconResponse.status()).toBe(200);
    expect(iconResponse.headers()["content-type"]).toContain("image/png");
  }
});

test("one mobile Chromium journey verifies the complete private MVP", async ({
  context,
  page,
}) => {
  test.setTimeout(60_000);
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.110" });
  await page.setViewportSize({ height: 844, width: 390 });
  await page.emulateMedia({ reducedMotion: "reduce" });

  await page.goto("/register");
  await expectNoSeriousAxeViolations(page);
  await page.getByLabel("Username").fill("release.owner");
  await page.getByLabel("Password", { exact: true }).fill(validPassword);
  await page.getByLabel("Confirm password").fill(validPassword);
  await page.getByRole("button", { name: "Create private account" }).click();

  await expect(page).toHaveURL("/setup");
  await page.getByLabel("Time zone").fill("America/New_York");
  await expectNoSeriousAxeViolations(page);
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL("/");

  await page.getByRole("link", { name: "Fri 28" }).click();
  await expect(page).toHaveURL("/?date=2026-08-28");
  await page.getByRole("link", { name: "Sat 29" }).click();
  await expect(page).toHaveURL("/?date=2026-08-29");

  await openUsdaSearch(page);
  await page
    .getByRole("searchbox", { name: "Search local foods" })
    .fill("yogurt");
  await page.getByRole("button", { name: "Search" }).click();
  await page.getByRole("link", { name: /Plain nonfat Greek yogurt/ }).click();
  await expectNoSeriousAxeViolations(page);
  await page.getByLabel("Quantity").fill("1.5");
  await page.getByRole("button", { name: "Add to Food Log" }).click();

  const foodEntry = page.getByRole("link", {
    name: /Plain nonfat Greek yogurt.*150\.5 kcal/,
  });
  await expect(foodEntry).toBeVisible();
  // Phone actions dock in a full-width bar, so no button sits over a visible entry.
  const actionBar = page.getByRole("complementary", { name: "Floating utilities" });
  expect((await actionBar.boundingBox())!.width).toBe(390);
  expect(
    await actionBar.evaluate((bar) => getComputedStyle(bar).backgroundColor),
  ).not.toBe("rgba(0, 0, 0, 0)");
  const coveredEntryPoints = await foodEntry.evaluate((entry) => {
    const bar = document
      .querySelector('[aria-label="Floating utilities"]')!
      .getBoundingClientRect();
    const box = entry.getBoundingClientRect();
    const covered: number[][] = [];
    for (let y = box.top + 8; y < Math.min(box.bottom - 8, bar.top); y += 6) {
      for (let x = box.left + 12; x < box.right - 12; x += 12) {
        if (!entry.contains(document.elementFromPoint(x, y))) covered.push([x, y]);
      }
    }
    return covered;
  });
  expect(coveredEntryPoints).toEqual([]);
  await expect(
    page.getByRole("progressbar", { name: "Calorie progress" }),
  ).toHaveAttribute("aria-valuetext", /150\.5 of 2,050 kcal target/);
  await page
    .getByRole("button", { name: "Show fiber, sugar, and sodium" })
    .click();
  await expect(
    page.getByRole("button", { name: "Show fiber, sugar, and sodium" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(
    page.getByRole("article", { name: /Fiber: 0 known.*incomplete/ }),
  ).toBeVisible();
  expect(await foodEntry.evaluate((entry) => getComputedStyle(entry).transitionDuration)).toBe(
    "0s",
  );

  await openUsdaSearch(page);
  await page
    .getByRole("searchbox", { name: "Search local foods" })
    .fill("timeout");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("heading", { name: "USDA is unavailable" }))
    .toBeVisible();
  await page.getByRole("link", { name: "Close food search" }).click();

  await foodEntry.click();
  await page.getByLabel("Food name").fill("Release yogurt");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Release yogurt", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Add Water", exact: true }).click();
  const waterDialog = page.getByRole("dialog", { name: "Add Water" });
  await expectNoSeriousAxeViolations(page);
  await waterDialog.getByRole("button", { name: "16 fl oz", exact: true }).click();
  await waterDialog.getByRole("button", { name: "Add water", exact: true }).click();
  await expect(waterDialog).not.toBeVisible();
  await expect(
    page.getByRole("progressbar", { name: "Water progress" }),
  ).toHaveAttribute("aria-valuetext", "16 fl oz of 80 fl oz target");
  await page.getByRole("link", { name: /2:00 PM.*Water.*16 fl oz/ }).click();
  const waterEditor = page.getByRole("dialog", { name: "Edit Water Event" });
  await expectNoSeriousAxeViolations(page);
  await waterEditor.getByRole("button", { name: "Custom", exact: true }).click();
  await waterEditor.getByLabel("Custom amount").fill("20");
  await waterEditor.getByRole("button", { name: "Save amount" }).click();
  await expect(
    page.getByRole("link", { name: /2:00 PM.*Water.*20 fl oz/ }),
  ).toBeVisible();
  await expectNoSeriousAxeViolations(page);

  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByLabel("Calories target").fill("1900");
  await page.getByRole("button", { name: "Save Daily Goal" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Daily Goal saved. Every day now uses it.",
  );
  await expectNoSeriousAxeViolations(page);
  await page.goto("/?date=2026-08-30");
  await expect(
    page.getByRole("progressbar", { name: "Calorie progress" }),
  ).toHaveAttribute("aria-valuetext", "0 of 1,900 kcal target");
  await page.goto("/?date=2026-08-29");

  await page.getByRole("link", { name: /Release yogurt/ }).click();
  await page.getByRole("button", { name: "Delete entry" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("link", { name: /2:00 PM.*Water.*20 fl oz/ }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("button", { name: "Confirm delete" }).click();
  await expect(page.getByText("No entries for this day")).toBeVisible();

  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/login");
  await expectNoSeriousAxeViolations(page);
  await page.getByLabel("Username").fill("release.owner");
  await page.getByLabel("Password", { exact: true }).fill(validPassword);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/");

  await page.getByRole("link", { name: "Settings" }).click();
  await page.goto("/account/password");
  await page.getByLabel("Current password").fill(validPassword);
  await page
    .getByLabel("New password", { exact: true })
    .fill("release replacement 🔐");
  await page
    .getByLabel("Confirm new password")
    .fill("release replacement 🔐");
  await page.getByRole("button", { name: "Change password" }).click();
  await expect(page.getByRole("status")).toContainText("Password changed");
  await expectNoSeriousAxeViolations(page);

  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});

test("a second user cannot list, read, edit, or delete another user's records", async ({
  browser,
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.111" });
  await completeSetupForTestUser(page, "release.isolation.owner");

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
  const foodFields = await page
    .getByRole("dialog", { name: "Edit Food Entry" })
    .locator("form")
    .evaluate((form) =>
      Object.fromEntries(new FormData(form as HTMLFormElement).entries()),
    );
  await page
    .getByRole("dialog", { name: "Edit Food Entry" })
    .getByRole("link", { name: "Cancel" })
    .click();

  await page.getByRole("button", { name: "Add Water", exact: true }).click();
  const isolationWaterDialog = page.getByRole("dialog", { name: "Add Water" });
  await isolationWaterDialog.getByRole("button", { name: "8 fl oz", exact: true }).click();
  await isolationWaterDialog.getByRole("button", { name: "Add water", exact: true }).click();
  await expect(isolationWaterDialog).not.toBeVisible();
  await page
    .getByRole("link", { name: /\d+:\d+ [AP]M.*Water.*8 fl oz/ })
    .click();
  const waterFields = await page
    .getByRole("dialog", { name: "Edit Water Event" })
    .locator("form")
    .evaluate((form) =>
      Object.fromEntries(new FormData(form as HTMLFormElement).entries()),
    );

  const database = openBrowserTestDatabase();
  const owner = database
    .prepare(
      `SELECT u.id AS userId
       FROM users u
       JOIN daily_goals g ON g.user_id = u.id
       WHERE u.username_normalized = ?`,
    )
    .get("release.isolation.owner") as { userId: number };
  database.close();

  const otherContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    ignoreHTTPSErrors: true,
    extraHTTPHeaders: { "X-Test-Client-IP": "203.0.113.112" },
  });
  const otherPage = await otherContext.newPage();
  await completeSetupForTestUser(otherPage, "release.isolation.other");

  await expect(otherPage.getByText("No entries for this day")).toBeVisible();
  await expect(
    otherPage.getByText("Plain nonfat Greek yogurt", { exact: true }),
  ).toHaveCount(0);
  await expect(
    otherPage.getByRole("link", {
      name: /\d+:\d+ [AP]M.*Water.*8 fl oz/,
    }),
  ).toHaveCount(0);

  const foodRead = await otherPage.goto(
    `/?date=2026-08-29&entry=${String(foodFields.id)}`,
  );
  expect(foodRead?.status()).toBe(404);
  const waterRead = await otherPage.goto(
    `/?date=2026-08-29&water=${String(waterFields.id)}`,
  );
  expect(waterRead?.status()).toBe(404);

  await otherPage.goto("/?date=2026-08-29");
  const foodCsrfToken = await csrfTokenFor(otherPage, "Add Food");
  const waterCsrfToken = await csrfTokenFor(otherPage, "Add Water");
  const mutationStatuses = await otherPage.evaluate(
    async ({ foodCsrfToken, foodFields, waterCsrfToken, waterFields }) => {
      const submit = (fields: Record<string, string>) =>
        fetch("/food-events", {
          body: new URLSearchParams(fields),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          method: "POST",
        });
      const statuses = [];
      for (const intent of ["update", "delete"]) {
        const response = await submit({
          ...(foodFields as Record<string, string>),
          csrfToken: foodCsrfToken,
          intent,
        });
        statuses.push(response.status);
      }
      const water = (fields: Record<string, string>) =>
        fetch("/water-events", {
          body: new URLSearchParams({ ...fields, csrfToken: waterCsrfToken }),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          method: "POST",
          redirect: "manual",
        });
      statuses.push((await water(waterFields as Record<string, string>)).status);
      const deletion = await water({
        eventIds: String((waterFields as Record<string, string>).id),
        intent: "delete",
        returnDate: "2026-08-29",
      });
      statuses.push(deletion.type === "opaqueredirect" ? 302 : deletion.status);
      return statuses;
    },
    { foodCsrfToken, foodFields, waterCsrfToken, waterFields },
  );
  expect(mutationStatuses).toEqual([404, 404, 404, 302]);
  const waterCheck = openBrowserTestDatabase();
  expect(
    waterCheck.prepare("SELECT ounces FROM water_events WHERE id = ? AND user_id = ?")
      .get(Number(waterFields.id), owner.userId),
  ).toEqual({ ounces: "8" });
  waterCheck.close();

  await otherPage.goto(
    `/settings/goals?userId=${owner.userId}`,
  );
  await expect(otherPage.getByText("release.isolation.owner")).toHaveCount(0);
  await otherPage
    .locator("form")
    .filter({ has: otherPage.getByRole("button", { name: "Save Daily Goal" }) })
    .evaluate((form, ownerId) => {
      const attemptedOwner = document.createElement("input");
      attemptedOwner.name = "userId";
      attemptedOwner.type = "hidden";
      attemptedOwner.value = String(ownerId);
      form.append(attemptedOwner);
    }, owner.userId);
  await otherPage.getByLabel("Calories target").fill("1750");
  await otherPage.getByRole("button", { name: "Save Daily Goal" }).click();
  await expect(otherPage.getByRole("status")).toContainText("Daily Goal saved");

  const goalFields = await otherPage
    .locator("form")
    .filter({ has: otherPage.getByRole("button", { name: "Save Daily Goal" }) })
    .evaluate((form) =>
      Object.fromEntries(new FormData(form as HTMLFormElement).entries()),
    );
  const ownerRecordMutationStatuses = await otherPage.evaluate(
    async ({ goalFields, owner }) => {
      const submit = (path: string, fields: Record<string, string>) =>
        fetch(path, {
          body: new URLSearchParams(fields),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          method: "POST",
        });
      const goalDeletion = await submit(
        `/settings/goals?userId=${owner.userId}`,
        {
          ...(goalFields as Record<string, string>),
          intent: "delete-daily-goal",
          userId: String(owner.userId),
        },
      );
      const setupFields = {
        calorieTarget: "1000",
        carbohydrateTarget: "100",
        csrfToken: String(goalFields.csrfToken),
        fatTarget: "50",
        fiberTarget: "20",
        preferenceUserId: String(owner.userId),
        proteinTarget: "80",
        sodiumMaximum: "1500",
        sugarMaximum: "30",
        timeZone: "UTC",
        userId: String(owner.userId),
        waterTarget: "64",
      };
      const preferenceEdit = await submit(
        `/setup?userId=${owner.userId}`,
        { ...setupFields, intent: "update-preference" },
      );
      const preferenceDeletion = await submit(
        `/setup?userId=${owner.userId}`,
        { ...setupFields, intent: "delete-preference" },
      );
      return [
        goalDeletion.status,
        preferenceEdit.status,
        preferenceDeletion.status,
      ];
    },
    { goalFields, owner },
  );
  expect(ownerRecordMutationStatuses).toEqual([200, 200, 200]);

  await otherPage.goto(`/setup?userId=${owner.userId}`);
  await expect(otherPage).toHaveURL("/");
  await expect(otherPage.getByText("release.isolation.owner")).toHaveCount(0);

  await page.getByRole("link", { name: "Close water dialog" }).click();
  await page.goto("/settings/goals");
  await expect(page.getByLabel("Calories target")).toHaveValue("2050");
  await expect(page.getByLabel("Water target")).toHaveValue("80");
  await expect(page.getByText("release.isolation.other")).toHaveCount(0);
  await expectNoSeriousAxeViolations(otherPage);
  await otherContext.close();
});

test("the critical mobile experience is operable with only a keyboard", async ({
  context,
  page,
}) => {
  test.setTimeout(60_000);
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.113" });
  await page.setViewportSize({ height: 844, width: 390 });
  await page.goto("/register");

  const username = page.getByLabel("Username");
  await tabTo(page, username);
  await page.keyboard.type("release.keyboard");
  const password = page.getByLabel("Password", { exact: true });
  await tabTo(page, password);
  await page.keyboard.type(validPassword);
  const confirmPassword = page.getByLabel("Confirm password");
  await tabTo(page, confirmPassword);
  await page.keyboard.type(validPassword);
  const register = page.getByRole("button", { name: "Create private account" });
  await tabTo(page, register);
  await page.keyboard.press("Enter");

  const timeZone = page.getByLabel("Time zone");
  await tabTo(page, timeZone);
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("America/New_York");
  const finishSetup = page.getByRole("button", { name: "Finish setup" });
  await tabTo(page, finishSetup);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/");

  const previousDate = page.getByRole("link", { name: "Fri 28" });
  await tabTo(page, previousDate);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/?date=2026-08-28");
  const today = page.getByRole("link", { name: "Sat 29" });
  await tabTo(page, today);
  await page.keyboard.press("Enter");

  const addFood = page.getByRole("button", { name: "Add Food" });
  await tabTo(page, addFood);
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("link", { name: "Close food search" }),
  ).toBeFocused();
  const searchForFood = page.getByRole("link", { name: /Search for food/ });
  await tabTo(page, searchForFood);
  await page.keyboard.press("Enter");
  const searchbox = page.getByRole("searchbox", {
    name: "Search local foods",
  });
  await tabTo(page, searchbox);
  await searchbox.pressSequentially("yogurt");
  await expect(searchbox).toHaveValue("yogurt");
  const search = page.getByRole("button", { name: "Search" });
  await tabTo(page, search);
  await page.keyboard.press("Enter");
  const foodResult = page.getByRole("link", {
    name: /Plain nonfat Greek yogurt/,
  });
  await tabTo(page, foodResult);
  await page.keyboard.press("Enter");
  const addToLog = page.getByRole("button", { name: "Add to Food Log" });
  await tabTo(page, addToLog);
  await page.keyboard.press("Enter");

  const foodEntry = page.getByRole("link", {
    name: /Plain nonfat Greek yogurt.*100\.3 kcal/,
  });
  await tabTo(page, foodEntry);
  await page.keyboard.press("Enter");
  const foodName = page.getByLabel("Food name");
  await tabTo(page, foodName);
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("Keyboard yogurt");
  const saveFood = page.getByRole("button", { name: "Save changes" });
  await tabTo(page, saveFood);
  await page.keyboard.press("Enter");
  await expect(page.getByText("Keyboard yogurt", { exact: true })).toBeVisible();

  const secondNutritionPage = page.getByRole("button", {
    name: "Show fiber, sugar, and sodium",
  });
  await tabTo(page, secondNutritionPage);
  await page.keyboard.press("Enter");
  await expect(secondNutritionPage).toHaveAttribute("aria-pressed", "true");

  const addWater = page.getByRole("button", { name: "Add Water", exact: true });
  await tabTo(page, addWater);
  await page.keyboard.press("Enter");
  const addWaterDialog = page.getByRole("dialog", { name: "Add Water" });
  await expect(addWaterDialog.getByRole("button", { name: "8 fl oz", exact: true })).toBeFocused();
  const newAmount = addWaterDialog.getByRole("button", { name: "16 fl oz", exact: true });
  await tabTo(page, newAmount);
  await page.keyboard.press("Enter");
  const saveWater = addWaterDialog.getByRole("button", { name: "Add water", exact: true });
  await tabTo(page, saveWater);
  await page.keyboard.press("Enter");
  await expect(addWaterDialog).not.toBeVisible();

  const waterEvent = page.getByRole("link", {
    name: /\d+:\d+ [AP]M.*Water.*16 fl oz/,
  });
  await tabTo(page, waterEvent);
  await page.keyboard.press("Enter");
  const waterEditor = page.getByRole("dialog", { name: "Edit Water Event" });
  await expect(waterEditor.getByRole("button", { name: "16 fl oz", exact: true })).toBeFocused();
  await tabTo(page, waterEditor.getByRole("button", { name: "Custom", exact: true }));
  await page.keyboard.press("Enter");
  const waterAmount = waterEditor.getByLabel("Custom amount");
  await expect(waterAmount).toBeFocused();
  await page.keyboard.press("ControlOrMeta+A");
  await waterAmount.pressSequentially("20");
  const updateWater = waterEditor.getByRole("button", { name: "Save amount" });
  await tabTo(page, updateWater);
  await page.keyboard.press("Enter");
  const updatedWaterEvent = page.getByRole("link", {
    name: /\d+:\d+ [AP]M.*Water.*20 fl oz/,
  });
  await tabTo(page, updatedWaterEvent);
  await page.keyboard.press("Enter");
  const deleteWater = waterEditor.getByRole("button", {
    name: "Delete",
    exact: true,
  });
  await tabTo(page, deleteWater);
  await page.keyboard.press("Enter");
  const confirmWaterDeletion = waterEditor.getByRole("button", {
    name: "Confirm delete",
  });
  await tabTo(page, confirmWaterDeletion);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Water Event deleted");

  const settings = page.getByRole("link", { name: "Settings" });
  await tabTo(page, settings);
  await page.keyboard.press("Enter");
  const calories = page.getByLabel("Calories target");
  await tabTo(page, calories);
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("1950");
  const saveGoal = page.getByRole("button", { name: "Save Daily Goal" });
  await tabTo(page, saveGoal);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Daily Goal saved");

  await page.setViewportSize({ height: 844, width: 320 });
  await expectMobileReflowAndTargets(page);

  const signOut = page.getByRole("button", { name: "Sign out" });
  await tabTo(page, signOut);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/login");
  await tabTo(page, page.getByLabel("Username"));
  await page.keyboard.type("release.keyboard");
  await tabTo(page, page.getByLabel("Password", { exact: true }));
  await page.keyboard.type(validPassword);
  const signIn = page.getByRole("button", { name: "Sign in" });
  await tabTo(page, signIn);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL("/");
  await expectMobileReflowAndTargets(page);
});
