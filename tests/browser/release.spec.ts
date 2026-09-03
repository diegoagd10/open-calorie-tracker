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
  ).toHaveAttribute("content", "Open Calory Tracker");

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
    .getByRole("searchbox", { name: "Search United States foods" })
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
    .getByRole("searchbox", { name: "Search United States foods" })
    .fill("timeout");
  await page.getByRole("button", { name: "Search" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Your saved Food Entries are unaffected.",
  );
  await expect(
    page.getByText("Plain nonfat Greek yogurt", { exact: true }),
  ).toBeAttached();
  await page.getByRole("link", { name: "Close food search" }).click();

  await foodEntry.click();
  await page.getByLabel("Food name").fill("Release yogurt");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Release yogurt", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Add Water" }).click();
  const waterDialog = page.getByRole("dialog", { name: "Add Water" });
  await expectNoSeriousAxeViolations(page);
  await waterDialog.getByRole("button", { name: /16 fl oz.*Bottle/ }).click();
  await waterDialog.getByRole("button", { name: "Add 16 fl oz" }).click();
  await expect(
    page.getByRole("progressbar", { name: "Water progress" }),
  ).toHaveAttribute("aria-valuetext", /16 of 80 fl oz target/);
  await page.getByRole("link", { name: /Water.*16 fl oz/ }).click();
  const waterEditor = page.getByRole("dialog", { name: "Edit Water Event" });
  await expectNoSeriousAxeViolations(page);
  await waterEditor
    .getByRole("button", { name: /Exact amount.*Custom/ })
    .click();
  await waterEditor.getByLabel("Amount fl oz").fill("20");
  await waterEditor.getByLabel("Event time").fill("09:15");
  await waterEditor.getByRole("button", { name: "Save changes" }).click();
  await expect(
    page.getByRole("link", { name: /9:15 AM.*Water.*20 fl oz/ }),
  ).toBeVisible();
  await expectNoSeriousAxeViolations(page);

  await page.getByRole("link", { name: "Settings" }).click();
  await page.getByLabel("Effective date").fill("2026-08-30");
  await page.getByLabel("Calories target").fill("1900");
  await page.getByRole("button", { name: "Save goal version" }).click();
  await expect(page.getByRole("status")).toHaveText(
    "Goal Version saved for August 30, 2026.",
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
  await page.getByRole("link", { name: /Water.*20 fl oz/ }).click();
  await page.getByRole("button", { name: "Delete Water Event" }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
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
  await page.getByRole("link", { name: /Account security/ }).click();
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
    .getByRole("searchbox", { name: "Search United States foods" })
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
  await page.getByRole("link", { name: "Close edit form" }).click();

  await page.getByRole("button", { name: "Add Water" }).click();
  await page
    .getByRole("dialog", { name: "Add Water" })
    .getByRole("button", { name: "Add 8 fl oz" })
    .click();
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
      `SELECT u.id AS userId, g.id AS goalId
       FROM users u
       JOIN goal_versions g ON g.user_id = u.id
       WHERE u.username_normalized = ?
       ORDER BY g.effective_date
       LIMIT 1`,
    )
    .get("release.isolation.owner") as { goalId: number; userId: number };
  database.close();

  const otherContext = await browser.newContext({
    baseURL: "https://localhost:4173",
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
    `/?date=2026-08-29&entry=${String(foodFields.entryId)}`,
  );
  expect(foodRead?.status()).toBe(404);
  const waterRead = await otherPage.goto(
    `/?date=2026-08-29&water=${String(waterFields.eventId)}`,
  );
  expect(waterRead?.status()).toBe(404);

  await otherPage.goto("/?date=2026-08-29");
  const foodCsrfToken = await csrfTokenFor(otherPage, "Add Food");
  const waterCsrfToken = await csrfTokenFor(otherPage, "Add Water");
  const mutationStatuses = await otherPage.evaluate(
    async ({ foodCsrfToken, foodFields, waterCsrfToken, waterFields }) => {
      const submit = (fields: Record<string, string>) =>
        fetch("/?index", {
          body: new URLSearchParams(fields),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          method: "POST",
        });
      const statuses = [];
      for (const intent of ["update-food", "delete-food"]) {
        const response = await submit({
          ...(foodFields as Record<string, string>),
          csrfToken: foodCsrfToken,
          intent,
        });
        statuses.push(response.status);
      }
      for (const intent of ["update-water", "delete-water"]) {
        const response = await submit({
          ...(waterFields as Record<string, string>),
          csrfToken: waterCsrfToken,
          intent,
        });
        statuses.push(response.status);
      }
      return statuses;
    },
    { foodCsrfToken, foodFields, waterCsrfToken, waterFields },
  );
  expect(mutationStatuses).toEqual([404, 404, 404, 404]);

  await otherPage.goto(
    `/settings/goals?userId=${owner.userId}&goalId=${owner.goalId}`,
  );
  await expect(otherPage.getByText("release.isolation.owner")).toHaveCount(0);
  await otherPage
    .locator("form")
    .filter({ has: otherPage.getByRole("button", { name: "Save goal version" }) })
    .evaluate((form, ownerId) => {
      const attemptedOwner = document.createElement("input");
      attemptedOwner.name = "userId";
      attemptedOwner.type = "hidden";
      attemptedOwner.value = String(ownerId);
      form.append(attemptedOwner);
    }, owner.userId);
  await otherPage.getByLabel("Calories target").fill("1750");
  await otherPage.getByRole("button", { name: "Save goal version" }).click();
  await expect(otherPage.getByRole("status")).toContainText("Goal Version saved");

  const goalFields = await otherPage
    .locator("form")
    .filter({ has: otherPage.getByRole("button", { name: "Save goal version" }) })
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
        `/settings/goals?userId=${owner.userId}&goalId=${owner.goalId}`,
        {
          ...(goalFields as Record<string, string>),
          goalId: String(owner.goalId),
          intent: "delete-goal-version",
          userId: String(owner.userId),
        },
      );
      const setupFields = {
        calories: "1000",
        carbohydrate: "100",
        csrfToken: String(goalFields.csrfToken),
        displayUnits: "metric",
        fat: "50",
        fiber: "20",
        preferenceUserId: String(owner.userId),
        protein: "80",
        sodium: "1500",
        sugar: "30",
        timeZone: "UTC",
        userId: String(owner.userId),
        water: "2000",
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

  await page.getByRole("link", { name: "Close water sheet" }).click();
  await page.goto("/settings/goals");
  await expect(page.getByLabel("Calories target")).toHaveValue("2050");
  await expect(page.getByLabel("US")).toBeChecked();
  await expect(page.getByText("America/New_York", { exact: true })).toBeVisible();
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
    name: "Search United States foods",
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

  const addWater = page.getByRole("button", { name: "Add Water" });
  await tabTo(page, addWater);
  await page.keyboard.press("Enter");
  const bottle = page
    .getByRole("dialog", { name: "Add Water" })
    .getByRole("button", { name: /16 fl oz.*Bottle/ });
  await tabTo(page, bottle);
  await page.keyboard.press("Space");
  const saveWater = page.getByRole("button", { name: "Add 16 fl oz" });
  await tabTo(page, saveWater);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Water Event added");

  const waterEvent = page.getByRole("link", {
    name: /\d+:\d+ [AP]M.*Water.*16 fl oz/,
  });
  await tabTo(page, waterEvent);
  await page.keyboard.press("Enter");
  const waterEditor = page.getByRole("dialog", { name: "Edit Water Event" });
  await expect(
    waterEditor.getByRole("button", { name: /8 fl oz.*Glass/ }),
  ).toBeFocused();
  const exactWater = waterEditor.getByRole("button", {
    name: /Exact amount.*Custom/,
  });
  await tabTo(page, exactWater);
  await page.keyboard.press("Space");
  const waterAmount = waterEditor.getByLabel("Amount fl oz");
  await tabTo(page, waterAmount);
  await page.keyboard.press("ControlOrMeta+A");
  await waterAmount.pressSequentially("20");
  const updateWater = waterEditor.getByRole("button", { name: "Save changes" });
  await tabTo(page, updateWater);
  await page.keyboard.press("Enter");
  const updatedWaterEvent = page.getByRole("link", {
    name: /\d+:\d+ [AP]M.*Water.*20 fl oz/,
  });
  await tabTo(page, updatedWaterEvent);
  await page.keyboard.press("Enter");
  const deleteWater = page.getByRole("button", {
    name: "Delete Water Event",
  });
  await tabTo(page, deleteWater);
  await page.keyboard.press("Enter");
  const confirmWaterDeletion = waterEditor.getByRole("button", {
    name: "Delete",
    exact: true,
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
  const saveGoal = page.getByRole("button", { name: "Save goal version" });
  await tabTo(page, saveGoal);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status")).toContainText("Goal Version saved");

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
