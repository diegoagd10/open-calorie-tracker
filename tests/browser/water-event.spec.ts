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

async function addWater(page: Page, ounces: string): Promise<Locator> {
  const dialog = page.getByRole("dialog", { name: "Add Water" });
  if (!(await dialog.isVisible())) await page.getByRole("button", { name: "Add Water", exact: true }).click();
  await expect(dialog).toBeVisible();
  if (["8", "11", "16", "24"].includes(ounces)) {
    await dialog.getByRole("button", { name: `${ounces} fl oz`, exact: true }).click();
  } else {
    await dialog.getByRole("button", { name: "Custom", exact: true }).click();
    await fillSteadily(dialog.getByLabel("Custom amount"), ounces);
  }
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
  await expect(addDialog.getByLabel("Consumed at")).toHaveCount(0);
  await expect(addDialog.getByRole("button", { name: "8 fl oz", exact: true })).toBeFocused();
  await expect(addDialog.getByRole("button", { name: "Add water", exact: true })).toBeDisabled();
  await addDialog.getByRole("button", { name: "16 fl oz", exact: true }).click();
  await addDialog.getByRole("button", { name: "Add water", exact: true }).click();

  await expect(addDialog).not.toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Water progress" })).toHaveAttribute(
    "aria-valuetext",
    "16 fl oz of 80 fl oz target",
  );
  const waterEventLink = page.getByRole("link", { name: /2:00 PM.*Water.*16 fl oz/ });
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
  await expect(editDialog.getByRole("button", { name: "16 fl oz", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(editDialog.getByRole("button", { name: "16 fl oz", exact: true })).toBeFocused();
  await editDialog.getByRole("button", { name: "Custom", exact: true }).click();
  await expect(editDialog.getByLabel("Custom amount")).toBeFocused();
  await editDialog.getByLabel("Custom amount").fill("20.25");
  await editDialog.getByRole("button", { name: "Save amount" }).click();

  await expect(page.getByRole("status")).toContainText(
    "Water Event updated. Daily total refreshed.",
  );
  const editedLink = page.getByRole("link", { name: /2:00 PM.*Water.*20\.25 fl oz/ });
  await expect(editedLink).toBeVisible();

  await editedLink.click();
  await expect(editDialog.getByRole("button", { name: "Custom", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(editDialog.getByLabel("Custom amount")).toHaveValue("20.25");
  await expect(editDialog.getByLabel("Custom amount")).toBeFocused();
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

test("water is shown in fluid ounces against the Daily Goal's water target", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.91" });
  await completeSetupForTestUser(page, "water.full.stack.ounces");

  await addWater(page, "8.125");
  await expect(page.locator("[data-water-editor-trigger]")).toContainText("8.125 fl oz");
  await expect(page.getByRole("progressbar", { name: "Water progress" })).toHaveAttribute(
    "aria-valuetext",
    "8.125 fl oz of 80 fl oz target",
  );
});

test("today's automatic consumption time advances until the amount is saved", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.93" });
  await completeSetupForTestUser(page, "water.automatic.time");
  await page.clock.install();
  await page.getByRole("button", { name: "Add Water", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add Water" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "8 fl oz", exact: true }).click();
  await page.clock.fastForward(65_000);
  await dialog.getByRole("button", { name: "Add water", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("link", { name: /2:01 PM.*Water.*8 fl oz/ })).toBeVisible();
});

test("historical water keeps the selected day and its automatic noon time", async ({ context, page }) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.94" });
  await completeSetupForTestUser(page, "water.historical.time");
  await page.goto("/?date=2026-08-28");
  const dialog = await addWater(page, "11");
  await expect(dialog).not.toBeVisible();
  await expect(page).toHaveURL(/date=2026-08-28$/);
  await expect(page.getByRole("link", { name: /12:00 PM.*Water.*11 fl oz/ })).toBeVisible();
});

test("presets and Custom work on mobile and preserve the custom amount", async ({ context, page }) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.95" });
  await completeSetupForTestUser(page, "water.mobile.presets");
  await page.setViewportSize({ width: 320, height: 720 });
  await page.getByRole("button", { name: "Add Water", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Add Water" });
  await expect(dialog).toBeVisible();
  for (const amount of ["8", "11", "16", "24"]) {
    const preset = dialog.getByRole("button", { name: `${amount} fl oz`, exact: true });
    await preset.click();
    await expect(preset).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.locator('button[aria-pressed="true"]')).toHaveCount(1);
  }
  await dialog.getByRole("button", { name: "Custom", exact: true }).click();
  const custom = dialog.getByLabel("Custom amount");
  await expect(custom).toBeFocused();
  await custom.fill("500.001");
  await expect(dialog.getByRole("alert")).toContainText("Enter an amount from 0.001 to 500 fl oz");
  await expect(dialog.getByRole("button", { name: "Add water", exact: true })).toBeDisabled();
  await custom.fill("12.5");
  await dialog.getByRole("button", { name: "16 fl oz", exact: true }).click();
  await expect(custom).not.toBeVisible();
  await dialog.getByRole("button", { name: "Custom", exact: true }).click();
  await expect(custom).toHaveValue("12.5");
  expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await dialog.getByRole("button", { name: "Add water", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator("[data-water-editor-trigger]").filter({ hasText: "12.5 fl oz" })).toBeVisible();
});
