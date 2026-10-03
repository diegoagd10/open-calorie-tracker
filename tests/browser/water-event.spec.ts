import AxeBuilder from "@axe-core/playwright";
import type { Locator, Page } from "@playwright/test";
import {
  bootstrapOrSignInBrowserTestUser,
  expect,
  test,
} from "./reset-database";

const validPassword = "correct horse 🔐 battery";

async function completeSetupForTestUser(page: Page, username: string) {
  await bootstrapOrSignInBrowserTestUser(page, username, validPassword);
  if (username.endsWith(".metric")) {
    await page.getByLabel("Metric", { exact: true }).check();
  }
  await page.getByLabel("Time zone").fill("America/New_York");
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL("/");
}

/** Fills a dialog field and waits until the value holds, so a late re-render cannot drop it. */
async function fillSteadily(field: Locator, value: string) {
  await expect(async () => {
    await field.fill(value);
    await expect(field).toHaveValue(value, { timeout: 1_000 });
  }).toPass();
}

async function addWater(page: Page, ounces: string, consumedAt?: string): Promise<Locator> {
  const dialog = page.getByRole("dialog", { name: "Add Water" });
  if (!(await dialog.isVisible())) await page.getByRole("button", { name: "Add Water", exact: true }).click();
  await expect(dialog).toBeVisible();
  if (consumedAt) await dialog.getByLabel("Consumed at").fill(consumedAt);
  await fillSteadily(dialog.getByLabel("Amount (fl oz)"), ounces);
  await dialog.getByRole("button", { name: "Add water", exact: true }).click();
  return dialog;
}

test("a user can add, inspect, edit, and delete one Water Event", async ({
  browser,
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.90" });
  await completeSetupForTestUser(page, "water.full.stack");

  await page.getByRole("button", { name: "Add Water", exact: true }).click();
  const addDialog = page.getByRole("dialog", { name: "Add Water" });
  await expect(addDialog.getByLabel("Consumed at")).toHaveValue("2026-08-29T14:00");
  await expect(addDialog.getByLabel("Consumed at")).toBeFocused();
  await addDialog.getByLabel("Consumed at").fill("2026-08-29T08:30");
  await addDialog.getByLabel("Amount (fl oz)").fill("16");
  await addDialog.getByRole("button", { name: "Add water", exact: true }).click();

  await expect(addDialog).not.toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Water progress" })).toHaveAttribute(
    "aria-valuetext",
    "16 fl oz of 80 fl oz target",
  );
  const waterEventLink = page.getByRole("link", { name: /8:30 AM.*Water.*16 fl oz/ });
  await page.setViewportSize({ height: 908, width: 385 });
  const mobileContentStartRatio = await waterEventLink.evaluate((link) => {
    const content = link.children.item(2);
    if (!(content instanceof HTMLElement)) {
      throw new Error("Water Event content was not rendered");
    }
    const linkBounds = link.getBoundingClientRect();
    const contentBounds = content.getBoundingClientRect();
    return (contentBounds.x - linkBounds.x) / linkBounds.width;
  });
  expect(mobileContentStartRatio).toBeLessThanOrEqual(0.2);
  await page.setViewportSize({ height: 720, width: 1_280 });
  await waterEventLink.click();

  const editDialog = page.getByRole("dialog", { name: "Edit Water Event" });
  await expect(editDialog).toBeVisible();
  await expect(editDialog.getByLabel("Consumed at")).toHaveCount(0);
  await expect(editDialog.getByLabel("Amount (fl oz)")).toHaveValue("16");
  await editDialog.getByLabel("Amount (fl oz)").fill("20.25");
  await editDialog.getByRole("button", { name: "Save amount" }).click();

  await expect(page.getByRole("status")).toContainText(
    "Water Event updated. Daily total refreshed.",
  );
  const editedLink = page.getByRole("link", { name: /8:30 AM.*Water.*20\.25 fl oz/ });
  await expect(editedLink).toBeVisible();

  await editedLink.click();
  const eventId = await editDialog.locator('input[name="id"]').inputValue();
  const otherContext = await browser.newContext();
  await otherContext.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.92" });
  const otherPage = await otherContext.newPage();
  await completeSetupForTestUser(otherPage, "water.full.stack.other");
  const unavailableRead = await otherPage.goto(`/?date=2026-08-29&water=${eventId}`);
  expect(unavailableRead?.status()).toBe(404);
  await otherPage.goto("/?date=2026-08-29");
  const otherCsrfToken = await otherPage
    .locator("form")
    .filter({ has: otherPage.getByRole("button", { name: "Add Water", exact: true }) })
    .locator('input[name="csrfToken"]')
    .inputValue();
  const unavailableEdit = await otherPage.evaluate(
    async ({ csrfToken, id }) => (await fetch("/water-events", {
      body: new URLSearchParams({ csrfToken, id, intent: "save", ounces: "1", returnDate: "2026-08-29" }),
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      method: "POST",
      redirect: "manual",
    })).status,
    { csrfToken: otherCsrfToken, id: eventId },
  );
  expect(unavailableEdit).toBe(404);
  await otherContext.close();
  await expect(editedLink).toBeVisible();

  await editDialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(editDialog.getByText("Delete this Water Event?")).toBeVisible();
  await editDialog.getByRole("button", { name: "Confirm delete" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Water Event deleted. Daily total updated.",
  );
  await expect(page.getByText("No entries for this day")).toBeVisible();

  const accessibilityScan = await new AxeBuilder({ page }).analyze();
  expect(accessibilityScan.violations).toEqual([]);
});

test("metric accounts see water in ml while entering fluid ounces", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.91" });
  await completeSetupForTestUser(page, "water.full.stack.metric");

  await addWater(page, "8");
  await expect(page.locator("[data-water-editor-trigger]")).toContainText("237 ml");
  await expect(page.getByRole("progressbar", { name: "Water progress" })).toHaveAttribute(
    "aria-valuetext",
    "237 ml of 2366 ml target",
  );
});

test("a future consumption time is stopped in the browser and, if forced, by the server", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.93" });
  await completeSetupForTestUser(page, "water.future.time");

  const dialog = await addWater(page, "8", "2026-08-29T23:00");
  const consumedAt = dialog.getByLabel("Consumed at");
  await expect(consumedAt).toHaveAttribute("max", "2026-08-29T14:00");
  expect(await consumedAt.evaluate((input) => (input as HTMLInputElement).validity.rangeOverflow)).toBe(true);
  await expect(dialog).toBeVisible();
  await expect(page).toHaveURL(/water=new$/);

  await consumedAt.evaluate((input) => input.removeAttribute("max"));
  await dialog.getByRole("button", { name: "Add water", exact: true }).click();
  await expect(dialog.getByRole("alert")).toHaveText(
    "Enter when the water was consumed; it cannot be in the future.",
  );
  await expect(consumedAt).toHaveValue("2026-08-29T23:00");
  await expect(dialog.getByLabel("Amount (fl oz)")).toHaveValue("8");

  await consumedAt.fill("2026-08-28T23:30");
  await dialog.getByRole("button", { name: "Add water", exact: true }).click();
  await expect(page).toHaveURL(/date=2026-08-28$/);
  await expect(page.getByRole("link", { name: /11:30 PM.*Water.*8 fl oz/ })).toBeVisible();
});
