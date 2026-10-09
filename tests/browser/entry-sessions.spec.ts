import { expect, test, submitPasswordLogin } from "./reset-database";
import { playwrightBrowserPorts } from "../../scripts/catalog-browser-runtime";

const password = "correct horse 🔐 battery";
const publicOrigin = `https://localhost:${playwrightBrowserPorts.public}`;
const lanOrigin = `http://127.0.0.1:${playwrightBrowserPorts.lan}`;

test("desktop and phone sessions share data across entries and logout stays local", async ({ page, context, browser, baseURL }) => {
  await page.goto("/register");
  await page.getByLabel("Username").fill("entry.admin");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByLabel("Confirm password").fill(password);
  await page.getByRole("button", { name: "Create private account" }).click();
  await expect(page).toHaveURL("/setup");
  const rejectedSetup = await page.evaluate(async () => (await fetch("/setup", {
    method: "POST", body: new URLSearchParams({ csrfToken: "changed" }),
  })).status);
  expect(rejectedSetup).toBe(403);
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/settings/goals");
  await page.getByLabel("Calories target").fill("1900");
  await page.getByRole("button", { name: "Save Daily Goal" }).click();
  await expect(page.getByRole("status")).toContainText("saved");

  const otherOrigin = baseURL === lanOrigin ? publicOrigin : lanOrigin;
  const phone = await browser.newContext({
    baseURL: otherOrigin, ignoreHTTPSErrors: true,
    viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
  });
  try {
    const otherPage = await phone.newPage();
    await otherPage.goto("/");
    await expect(otherPage).toHaveURL(`${otherOrigin}/login`);
    await submitPasswordLogin(otherPage, "entry.admin", password);
    await expect(otherPage).toHaveURL(`${otherOrigin}/`);
    await otherPage.goto("/settings/goals");
    await expect(otherPage.getByLabel("Calories target")).toHaveValue("1900");
    const firstCookie = (await context.cookies()).find(cookie => cookie.name.endsWith("calorie_session") || cookie.name === "calorie_lan_session");
    const secondCookie = (await phone.cookies()).find(cookie => cookie.name.endsWith("calorie_session") || cookie.name === "calorie_lan_session");
    expect(firstCookie?.value).toBeTruthy();
    expect(secondCookie?.value).toBeTruthy();
    expect(secondCookie?.value).not.toBe(firstCookie?.value);
    const cookies = [...await context.cookies(), ...await phone.cookies()];
    expect(cookies.find(cookie => cookie.name === "__Host-calorie_session")?.secure).toBe(true);
    expect(cookies.find(cookie => cookie.name === "calorie_lan_session")?.secure).toBe(false);
    const otherCsrf = await otherPage.locator('[name="csrfToken"]').first().inputValue();
    const rejected = await page.evaluate(async csrfToken => {
      const statuses: number[] = [];
      for (const route of ["/?index", "/logout", "/settings/goals", "/settings/catalogs", "/settings/users", "/account/password", "/catalog-notifications"]) {
        statuses.push((await fetch(route, { method: "POST", body: new URLSearchParams({ csrfToken }) })).status);
      }
      return statuses;
    }, otherCsrf);
    expect(rejected).toEqual(Array<number>(7).fill(403));
    await otherPage.getByRole("button", { name: "Sign out" }).click();
    await expect(otherPage).toHaveURL(`${otherOrigin}/login`);
    await page.reload();
    await expect(page).toHaveURL(`${baseURL}/settings/goals`);
    await expect(page.getByLabel("Calories target")).toHaveValue("1900");
  } finally {
    await phone.close();
  }
});
