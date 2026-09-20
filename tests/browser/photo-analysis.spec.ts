import AxeBuilder from "@axe-core/playwright";
import {
  bootstrapOrSignInBrowserTestUser,
  expect,
  openBrowserTestDatabase,
  signInProvisionedMember,
  test,
} from "./reset-database";
import { playwrightBrowserPorts } from "../../scripts/catalog-browser-runtime";
import { PHOTO_ANALYSIS_TEST_READINESS_KEY } from "../../app/photo-analysis/test-fixture.server";

const publicOrigin = `https://localhost:${playwrightBrowserPorts.public}`;
const escapedPublicOrigin = publicOrigin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const photo = {
  name: "plate.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFElEQVR4nGP4TyJgGNUwqmH4agAAr639H708R/EAAAAASUVORK5CYII=",
    "base64",
  ),
};

test("readiness blocks only photo capture with role-appropriate recovery", async ({ page, browser }) => {
  const password = "correct horse 🔐 battery";
  await bootstrapOrSignInBrowserTestUser(page, "photo.readiness.admin", password);
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL("/");
  const database = openBrowserTestDatabase();
  database.prepare(`
    INSERT INTO application_metadata (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(
    PHOTO_ANALYSIS_TEST_READINESS_KEY,
    "missing-credentials",
    "2026-09-20T00:00:00.000Z",
  );
  database.close();

  await page.reload();
  await page.getByRole("button", { name: "Add Food", exact: true }).click();
  await expect(page.getByLabel("Take photo · AI calories")).toBeDisabled();
  await expect(page.getByRole("dialog")).toContainText(
    "Configure Gemini and TypeSafe credentials.",
  );
  await expect(page.getByRole("link", { name: "Open settings" })).toHaveAttribute(
    "href",
    "/settings/ai",
  );
  await expect(page.getByRole("link", { name: /Manual/ })).toBeEnabled();

  const context = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    ignoreHTTPSErrors: true,
  });
  try {
    const member = await context.newPage();
    await signInProvisionedMember(member, "photo.readiness.member", password);
    await member.getByRole("button", { name: "Finish setup" }).click();
    await expect(member).toHaveURL("/");
    await member.getByRole("button", { name: "Add Food", exact: true }).focus();
    await member.keyboard.press("Enter");
    await expect(member.getByLabel("Take photo · AI calories")).toBeDisabled();
    await expect(member.getByRole("dialog")).toContainText(
      "AI photo analysis is not available right now.",
    );
    await expect(member.getByRole("link", { name: "Open settings" })).toHaveCount(0);
    await expect(member.getByRole("link", { name: /Manual/ })).toBeEnabled();
    await member.goto("about:blank");
    await context.close();

    await page.goto("about:blank");
    const transition = openBrowserTestDatabase();
    transition.prepare(`
      UPDATE application_metadata SET value = ?, updated_at = ? WHERE key = ?
    `).run(
      "catalog-reimport-required",
      "2026-09-20T00:01:00.000Z",
      PHOTO_ANALYSIS_TEST_READINESS_KEY,
    );
    transition.close();
    await page.goto(publicOrigin);
    await page.getByRole("button", { name: "Add Food", exact: true }).click();
    await expect(page.getByLabel("Take photo · AI calories")).toBeDisabled();
    await expect(page.getByRole("dialog")).toContainText(
      "Reimport USDA Foundation for Photo Analysis.",
    );
    await expect(page.getByRole("link", { name: "Open settings" })).toHaveAttribute(
      "href",
      "/settings/catalogs",
    );

    await page.goto("about:blank");
    const ready = openBrowserTestDatabase();
    ready.prepare(
      "DELETE FROM application_metadata WHERE key = ?",
    ).run(PHOTO_ANALYSIS_TEST_READINESS_KEY);
    ready.close();
    await page.goto(publicOrigin);
    await page.getByRole("button", { name: "Add Food", exact: true }).click();
    await expect(page.getByLabel("Take photo · AI calories")).toBeEnabled();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  } finally {
    await context.close();
    const cleanup = openBrowserTestDatabase();
    cleanup.prepare(
      "DELETE FROM application_metadata WHERE key = ?",
    ).run(PHOTO_ANALYSIS_TEST_READINESS_KEY);
    cleanup.close();
  }
});

test("plate capture returns to Daily Log, survives reload, and supports correction and cancellation @camera-matrix", async ({
  page,
}, testInfo) => {
  await bootstrapOrSignInBrowserTestUser(
    page,
    "photo.browser",
    "correct horse 🔐 battery",
  );
  await page.getByLabel("Time zone").fill("America/New_York");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/?date=2026-08-28");
  await expect(page.getByLabel("Take photo · AI calories")).toHaveCount(0);
  await page.getByRole("button", { name: "Add Food", exact: true }).click();
  await expect(page.getByRole("dialog").getByLabel("Take photo · AI calories")).toBeVisible();
  const meals = page.getByRole("region", { name: "Daily log entries", exact: true });
  let resumeUpload!: () => void;
  const uploadReleased = new Promise<void>((resolve) => {
    resumeUpload = resolve;
  });
  await page.route("**/photo-analysis.data", async (route) => {
    await uploadReleased;
    await route.continue();
  }, { times: 1 });
  try {
    await page.getByLabel("Take photo · AI calories").setInputFiles(photo);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const preview = meals.getByRole("img", { name: "Plate being uploaded" });
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute(
      "src",
      new RegExp(`^blob:${escapedPublicOrigin}/`),
    );
    await expect.poll(() => preview.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBe(16);
    await expect(meals.getByRole("progressbar", { name: "Uploading photo", exact: true })).toBeVisible();
  } finally {
    resumeUpload();
  }
  await expect(
    meals.getByRole("progressbar", { name: "Analyzing photo" }),
  ).toBeVisible();
  await expect(page).toHaveURL(/date=2026-08-28/);
  await page.reload();
  await expect(
    meals.getByRole("link", { name: /Photo rice plate/ }),
  ).toBeVisible();
  await expect(meals.getByRole("img")).toHaveCount(0);
  const originalEntryHref = await meals.getByRole("link", { name: /Photo rice plate/ }).getAttribute("href");
  await expect(meals).toContainText("250 kcal");
  await page.getByRole("button", { name: "Add Food", exact: true }).click();
  await page.getByRole("link", { name: /Manual/ }).click();
  await page.getByLabel("Food name").fill("Timeline egg");
  await page.getByLabel("Calories (kcal)").fill("50");
  await page.getByRole("button", { name: "Add to Food Log", exact: true }).click();
  await expect(meals.getByRole("link", { name: /Timeline egg/ })).toBeVisible();
  await expect(meals.getByRole("link")).toHaveCount(2);
  const order = await meals.getByRole("link").allTextContents();
  expect(order[0]).toContain("Timeline egg");
  expect(order[1]).toContain("Photo rice plate");
  await expect(meals.getByRole("button", { name: /Add (Food|Water)/ })).toHaveCount(0);
  const photoCard = meals.getByRole("link", { name: /Photo rice plate/ });
  const manualCard = meals.getByRole("link", { name: /Timeline egg/ });
  await expect(photoCard).toBeVisible();
  const photoBox = await photoCard.boundingBox();
  const manualBox = await manualCard.boundingBox();
  expect(photoBox!.x).toBe(manualBox!.x);
  expect(photoBox!.width).toBe(manualBox!.width);
  expect(photoBox!.height).toBe(manualBox!.height);
  await page.screenshot({ path: testInfo.outputPath("unified-timeline-mobile.png") });
  await meals.getByRole("link", { name: /Photo rice plate/ }).click();
  const analysisDetails = page.getByRole("region", { name: "Photo analysis details" });
  await expect(analysisDetails.getByRole("img")).toBeVisible();
  await analysisDetails.getByText("Components, sources and assumptions", { exact: true }).click();
  await expect(analysisDetails).toContainText(
    "Gemini estimate: No USDA category adequately matched the visible component.",
  );
  await expect(analysisDetails).not.toContainText("selectedProbability");
  await page.getByRole("button", { name: "Correct with AI" }).click();
  await page
    .getByRole("textbox", { name: "Correction", exact: true })
    .fill("It has butter");
  let resumeCorrection!: () => void;
  const correctionReleased = new Promise<void>(resolve => { resumeCorrection = resolve; });
  await page.route("**/photo-analysis.data", async route => {
    await correctionReleased;
    await route.continue();
  }, { times: 1 });
  try {
    await page.getByRole("button", { name: "Apply correction" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(meals.getByRole("link", { name: /Photo rice plate/ })).toHaveCount(0);
    await expect(meals.getByRole("article")).toHaveCount(2);
    const updating = meals.getByRole("article").filter({ hasText: "Photo rice plate" });
    await expect(updating).toHaveAttribute("aria-busy", "true");
    await expect(updating.getByRole("progressbar")).toBeVisible();
    await expect(updating).toContainText("Updating this meal");
    await expect(updating).toContainText("250 kcal");
    await expect(updating.getByRole("button", { name: /Copy/ })).toHaveCount(0);
    await expect(meals.getByRole("link", { name: /Timeline egg/ })).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath("correcting-same-entry.png") });
  } finally {
    resumeCorrection();
  }
  await expect(meals.getByRole("progressbar")).toBeVisible();
  await expect(meals.getByRole("link", { name: /Photo rice plate/ })).toHaveCount(0);
  await expect(meals).toContainText("250 kcal");
  await expect(
    page.getByRole("button", { name: "Add Food", exact: true }),
  ).toBeEnabled();
  await expect(meals).toContainText("350 kcal");
  await expect(meals.getByRole("link", { name: /Photo rice plate/ })).toHaveAttribute("href", originalEntryHref!);
  await expect(meals.getByRole("article")).toHaveCount(2);
  await meals.getByRole("link", { name: /Photo rice plate/ }).click();
  await page.getByRole("button", { name: "Correct with AI" }).click();
  await page
    .getByRole("textbox", { name: "Correction", exact: true })
    .fill("fail this analysis");
  await page.getByRole("button", { name: "Apply correction" }).click();
  await expect(
    meals.getByRole("button", { name: "Retry analysis" }),
  ).toBeVisible();
  await expect(meals).toContainText("350 kcal");
  await meals.getByRole("button", { name: "Retry analysis" }).click();
  await meals.getByRole("button", { name: "Cancel analysis" }).click();
  await expect(meals).toContainText("Analysis canceled");
  await expect(meals).toContainText("350 kcal");
  await meals.getByRole("link", { name: /Photo rice plate/ }).click();
  await page.getByRole("button", { name: "Correct with AI" }).click();
  await page.getByRole("textbox", { name: "Correction", exact: true }).fill("Diet soda");
  await page.route("**/photo-analysis.data", async route => {
    const form = new URLSearchParams(route.request().postData()!);
    form.set("correction", "");
    await route.continue({ postData: form.toString() });
  }, { times: 1 });
  await page.getByRole("button", { name: "Apply correction" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(meals.getByRole("alert")).toContainText("Correction could not start");
  await expect(meals.getByRole("article")).toHaveCount(2);
  await expect(meals.getByRole("link", { name: /Photo rice plate/ })).toHaveAttribute("href", originalEntryHref!);
  await expect(meals.getByRole("progressbar")).toHaveCount(0);
  await expect(meals).toContainText("350 kcal");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test("non-food photos show a persistent failure and rejected uploads explain the error @camera-matrix", async ({ page }) => {
  await bootstrapOrSignInBrowserTestUser(page, "photo.failure", "correct horse 🔐 battery");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await page.getByRole("button", { name: "Add Food", exact: true }).click();
  await page.getByLabel("Take photo · AI calories").setInputFiles({
    ...photo, buffer: Buffer.concat([photo.buffer, Buffer.from("no-food")]),
  });
  const meals = page.getByRole("region", { name: "Daily log entries", exact: true });
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(meals.getByRole("progressbar", { name: "Analyzing photo" })).toBeVisible();
  await expect(meals).toContainText("No food or drink detected");
  await expect(meals.getByRole("button", { name: "Retry analysis" })).toBeVisible();
  await expect(meals.getByRole("link")).toHaveCount(0);
  await page.reload();
  await expect(meals).toContainText("No food or drink detected");
  await expect(meals.getByRole("img", { name: "Your plate" })).toBeVisible();
  await meals.getByRole("button", { name: "Delete photo meal" }).click();
  await expect(meals).toHaveCount(0);
  await page.getByRole("button", { name: "Add Food", exact: true }).click();
  await page.getByLabel("Take photo · AI calories").setInputFiles({
    name: "invalid.png", mimeType: "image/png", buffer: Buffer.alloc(32),
  });
  await expect(meals.getByRole("alert")).toContainText("Choose a JPEG, PNG, or WebP photo");
  await expect(meals.getByRole("button", { name: "Retry upload" })).toBeVisible();
});
