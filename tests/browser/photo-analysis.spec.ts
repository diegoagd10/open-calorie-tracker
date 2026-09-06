import AxeBuilder from "@axe-core/playwright";
import {
  bootstrapOrSignInBrowserTestUser,
  expect,
  test,
} from "./reset-database";

const photo = {
  name: "plate.png",
  mimeType: "image/png",
  buffer: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFElEQVR4nGP4TyJgGNUwqmH4agAAr639H708R/EAAAAASUVORK5CYII=",
    "base64",
  ),
};

test("plate capture returns to Daily Log, survives reload, and supports correction and cancellation @camera-matrix", async ({
  page,
}) => {
  await bootstrapOrSignInBrowserTestUser(
    page,
    "photo.browser",
    "correct horse 🔐 battery",
  );
  await page.getByLabel("Time zone").fill("America/New_York");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/?date=2026-08-28");
  const meals = page.getByRole("region", { name: "Photo meals", exact: true });
  let resumeUpload!: () => void;
  const uploadReleased = new Promise<void>((resolve) => {
    resumeUpload = resolve;
  });
  await page.route("**/photo-analysis.data", async (route) => {
    await uploadReleased;
    await route.continue();
  }, { times: 1 });
  try {
    await page.getByLabel("Take plate photo").setInputFiles(photo);
    const preview = meals.getByRole("img", { name: "Plate being uploaded" });
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute("src", /^blob:https:\/\/localhost:4173\//);
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
  await expect(meals.getByRole("img", { name: "Your plate" })).toBeVisible();
  await expect(
    meals.getByRole("link", { name: "Photo rice plate" }),
  ).toBeVisible();
  await expect(meals).toContainText("250 kcal");
  await meals.getByRole("link", { name: "Photo rice plate" }).click();
  await page.getByRole("button", { name: "Correct with AI" }).click();
  await page
    .getByRole("textbox", { name: "Correction", exact: true })
    .fill("It has butter");
  await page.getByRole("button", { name: "Apply correction" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(meals.getByRole("progressbar")).toBeVisible();
  await expect(meals.getByRole("link")).toHaveCount(0);
  await expect(meals).toContainText("250 kcal");
  await expect(
    page.getByRole("button", { name: "Add Food", exact: true }),
  ).toBeEnabled();
  await expect(meals).toContainText("350 kcal");
  await meals.getByRole("link", { name: "Photo rice plate" }).click();
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
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});
