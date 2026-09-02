import path from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { expect, test as base } from "@playwright/test";
import type { Page } from "@playwright/test";

import { hashPassword } from "../../app/auth/password.server";

let authenticationDatabaseReset = false;
const browserTestDatabasePath = path.resolve(
  "data",
  "playwright-tests",
  "application.sqlite",
);

export function openBrowserTestDatabase(
  options: { readonly?: boolean } = {},
) {
  return new BetterSqlite3(browserTestDatabasePath, options);
}

export const test = base.extend<{ databaseReset: void }>({
  databaseReset: [
    async ({ browserName: _browserName }, use, testInfo) => {
      const authenticationFile = testInfo.file.endsWith(
        "authentication.spec.ts",
      );
      if (!authenticationFile || !authenticationDatabaseReset) {
        const database = openBrowserTestDatabase();
        database.pragma("foreign_keys = ON");
        database.pragma("busy_timeout = 5000");
        database.transaction(() => {
          database.prepare("DELETE FROM users").run();
          database
            .prepare("DELETE FROM pre_authentication_csrf_sessions")
            .run();
          database.prepare("DELETE FROM rate_limit_counters").run();
        }).immediate();
        database.close();
        if (authenticationFile) authenticationDatabaseReset = true;
      }
      await use();
    },
    { auto: true },
  ],
});

export { expect };

export async function provisionBrowserTestMember(
  username: string,
  password: string,
): Promise<void> {
  const database = openBrowserTestDatabase();
  database.pragma("foreign_keys = ON");
  database.pragma("busy_timeout = 5000");
  const passwordHash = await hashPassword(password);
  const timestamp = "2026-08-29T12:00:00.000Z";
  database.transaction(() => {
    const user = database
      .prepare(
        `INSERT INTO users (username_normalized, role, created_at)
         VALUES (?, 'member', ?)
         RETURNING id`,
      )
      .get(username, timestamp) as { id: number };
    database
      .prepare(
        `INSERT INTO password_credentials
           (user_id, password_hash, updated_at)
         VALUES (?, ?, ?)`,
      )
      .run(user.id, passwordHash, timestamp);
  }).immediate();
  database.close();
}

export async function signInProvisionedMember(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  await provisionBrowserTestMember(username, password);
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL("/setup");
}

export async function bootstrapOrSignInBrowserTestUser(
  page: Page,
  username: string,
  password: string,
): Promise<void> {
  await page.goto("/register");
  if (new URL(page.url()).pathname === "/login") {
    await signInProvisionedMember(page, username, password);
  } else {
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByLabel("Confirm password").fill(password);
    await page.getByRole("button", { name: "Create private account" }).click();
  }
  await expect(page).toHaveURL("/setup");
}
