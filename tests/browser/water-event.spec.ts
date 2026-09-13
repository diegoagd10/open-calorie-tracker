import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
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

test("a user can add, inspect, edit, and delete one Water Event", async ({
  browser,
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.90" });
  await completeSetupForTestUser(page, "water.full.stack");

  await page.getByRole("button", { name: "Add Water" }).click();
  const addDialog = page.getByRole("dialog", { name: "Add Water" });
  await expect(addDialog).toBeVisible();
  await addDialog.getByRole("button", { name: /16 fl oz.*Bottle/ }).click();
  await addDialog.getByRole("button", { name: "Add 16 fl oz" }).click();

  await expect(addDialog).not.toBeVisible();
  await expect(page.getByText("Water Event added. Daily total updated.")).toHaveCount(0);
  await expect(page.getByRole("progressbar", { name: "Water progress" })).toHaveAttribute(
    "aria-valuetext",
    /16 of 80 fl oz target/,
  );
  const waterEventLink = page.getByRole("link", { name: /Water.*16 fl oz/ });
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
  await editDialog.getByRole("button", { name: /Exact amount.*Custom/ }).click();
  await editDialog.getByLabel("Amount fl oz").fill("20");
  await editDialog.getByLabel("Event time").fill("09:15");
  await editDialog.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByRole("status")).toContainText(
    "Water Event updated. Daily total refreshed.",
  );
  await expect(page.getByRole("link", { name: /9:15 AM.*Water.*20 fl oz/ })).toBeVisible();

  await page.getByRole("link", { name: /9:15 AM.*Water.*20 fl oz/ }).click();
  const ownerFields = await editDialog.locator("form").evaluate((form) =>
    Object.fromEntries(new FormData(form as HTMLFormElement).entries()),
  );
  const otherContext = await browser.newContext();
  await otherContext.setExtraHTTPHeaders({
    "X-Test-Client-IP": "203.0.113.92",
  });
  const otherPage = await otherContext.newPage();
  await completeSetupForTestUser(otherPage, "water.full.stack.other");
  const unavailableRead = await otherPage.goto(
    `/?date=2026-08-29&water=${String(ownerFields.eventId)}`,
  );
  expect(unavailableRead?.status()).toBe(404);
  await otherPage.goto("/?date=2026-08-29");
  const otherCsrfToken = await otherPage
    .locator("form")
    .filter({ has: otherPage.getByRole("button", { name: "Add Water" }) })
    .locator('input[name="csrfToken"]')
    .inputValue();
  const unavailableMutations = await otherPage.evaluate(
    async ({ csrfToken, eventId, expectedUpdatedAt }) => {
      const submit = (intent: "delete-water" | "update-water") =>
        fetch("/?index", {
          body: new URLSearchParams({
            csrfToken,
            date: "2026-08-29",
            eventId,
            expectedUpdatedAt,
            intent,
            waterAmount: "12",
            waterEventTime: "10:15",
            waterSelection: "exact",
          }),
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          method: "POST",
        });
      const update = await submit("update-water");
      const deletion = await submit("delete-water");
      return [update.status, deletion.status];
    },
    {
      csrfToken: otherCsrfToken,
      eventId: String(ownerFields.eventId),
      expectedUpdatedAt: String(ownerFields.expectedUpdatedAt),
    },
  );
  expect(unavailableMutations).toEqual([404, 404]);
  await otherContext.close();

  await page.getByRole("button", { name: "Delete Water Event" }).click();
  await expect(editDialog.getByText("Delete this Water Event?")).toBeVisible();
  await editDialog.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "Water Event deleted. Daily total updated.",
  );
  await expect(page.getByText("No entries for this day")).toBeVisible();

  const accessibilityScan = await new AxeBuilder({ page }).analyze();
  expect(accessibilityScan.violations).toEqual([]);
});

test("metric display converts the canonical US water presets", async ({
  context,
  page,
}) => {
  await context.setExtraHTTPHeaders({ "X-Test-Client-IP": "203.0.113.91" });
  await completeSetupForTestUser(page, "water.full.stack.metric");

  await page.getByRole("button", { name: "Add Water" }).click();
  const dialog = page.getByRole("dialog", { name: "Add Water" });
  await expect(dialog.getByRole("button", { name: /237 ml.*Glass/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /473 ml.*Bottle/ })).toBeVisible();
  await expect(dialog.getByRole("button", { name: /710 ml.*Large/ })).toBeVisible();
  await dialog.getByRole("button", { name: /Exact amount.*Custom/ }).click();
  await dialog.getByLabel("Amount ml").fill("0.001");
  await dialog.getByRole("button", { name: "Add exact amount" }).click();

  await expect(page.getByRole("link", { name: /Water.*0\.001 ml/ })).toBeVisible();
  await expect(page.getByRole("progressbar", { name: "Water progress" })).toHaveAttribute(
    "aria-valuetext",
    /0\.001 of 2,366 ml target/,
  );

  await page.getByRole("button", { name: "Add Water" }).click();
  await dialog.getByRole("button", { name: /237 ml.*Glass/ }).click();
  await dialog.getByRole("button", { name: "Add 237 ml" }).click();

  await expect(page.getByRole("link", { name: /Water.*236\.588 ml/ })).toBeVisible();
  await expect(page.getByText(/1 equivalent glass · 8 fl oz \/ 237 ml/)).toBeVisible();
});
