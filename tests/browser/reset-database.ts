import { existsSync, readFileSync } from "node:fs";
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

const offApiRequestLog = path.resolve("data", "playwright-tests", "off-api-requests.jsonl");

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
          database.prepare("DELETE FROM application_metadata WHERE key = 'off:contact'").run();
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

/** Enables barcode lookup the way an administrator's Food Catalogs contact email does. */
export function configureBarcodeContact(email = "family@example.com"): void {
  const database = openBrowserTestDatabase();
  database.pragma("busy_timeout = 5000");
  database
    .prepare(
      `INSERT INTO application_metadata (key, value, updated_at) VALUES ('off:contact', ?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(email, "2026-08-29T12:00:00.000Z");
  database.close();
}

/** The Open Food Facts requests the preloaded API fixture has answered, oldest first. */
export function recordedOffApiRequests(): { url: string; userAgent: string | null }[] {
  if (!existsSync(offApiRequestLog)) return [];
  return readFileSync(offApiRequestLog, "utf8").trim().split("\n").filter(Boolean)
    .map((line) => JSON.parse(line) as { url: string; userAgent: string | null });
}

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
