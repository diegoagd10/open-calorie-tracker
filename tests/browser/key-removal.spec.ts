import AxeBuilder from "@axe-core/playwright";
import {
  bootstrapOrSignInBrowserTestUser,
  expect,
  test,
} from "./reset-database";
import { playwrightBrowserPorts } from "../../scripts/catalog-browser-runtime";

const password = "correct horse battery staple";
const publicOrigin = `https://localhost:${playwrightBrowserPorts.public}`;

for (const enabled of [true, false]) {
  test(`five-key deletion with key login enabled=${enabled} requires fresh proof and reaches password mode`, async ({
    context,
    page,
    browser,
  }, testInfo) => {
    test.skip(
      testInfo.project.name !== "chromium",
      "Virtual authenticators require public Chromium CDP.",
    );
    test.setTimeout(90_000);
    await page.setViewportSize({ width: 390, height: 844 });
    const cdp = await context.newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    let activeId = "";
    async function plugKey() {
      if (activeId)
        await cdp.send("WebAuthn.removeVirtualAuthenticator", {
          authenticatorId: activeId,
        });
      const result = await cdp.send("WebAuthn.addVirtualAuthenticator", {
        options: {
          protocol: "ctap2",
          transport: "usb",
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: true,
          automaticPresenceSimulation: true,
        },
      });
      activeId = result.authenticatorId;
    }
    async function rememberKey() {
      return (
        await cdp.send("WebAuthn.getCredentials", { authenticatorId: activeId })
      ).credentials[0];
    }
    await plugKey();
    const saved = (
      await cdp.send("WebAuthn.getCredentials", { authenticatorId: activeId })
    ).credentials;
    const username = `delete.owner.${enabled}`;
    await bootstrapOrSignInBrowserTestUser(page, username, password);
    await page.getByRole("button", { name: "Finish setup" }).click();
    await expect(page).toHaveURL("/");
    await page.goto("/settings/security");
    await page.getByLabel("Key name").fill("Key 1");
    await page
      .getByRole("button", { name: "Enroll and enable key login" })
      .click();
    await expect(page.getByText("Key 1", { exact: true })).toBeVisible();
    saved.push(await rememberKey());
    for (let n = 2; n <= 5; n++) {
      await page.route("**/key-ceremony", async (route) => {
        if (
          (route.request().postDataJSON() as { action: string }).action !==
          "addition-finish"
        )
          return route.continue();
        const response = await route.fetch();
        expect(response.status()).toBe(200);
        saved[saved.length - 1] = await rememberKey();
        await plugKey();
        await route.fulfill({ response });
      });
      await page.getByLabel("Key name").fill(`Key ${n}`);
      await page.getByRole("button", { name: "Add another key" }).click();
      await expect(page.getByText(`Key ${n}`, { exact: true })).toBeVisible();
      await page.unroute("**/key-ceremony");
      saved.push(await rememberKey());
    }
    async function useKey(n: number) {
      await plugKey();
      await cdp.send("WebAuthn.addCredential", {
        authenticatorId: activeId,
        credential: saved[n],
      });
    }
    async function keyLogin(n: number) {
      await useKey(n);
      await page.goto("/login");
      await page.getByLabel("Username").fill(username);
      await page
        .getByRole("button", { name: "Use registered key", exact: true })
        .click();
      await expect(page).toHaveURL("/");
      saved[n] = await rememberKey();
    }
    async function signOut() {
      await page.goto("/settings/goals");
      await page.getByRole("button", { name: "Sign out" }).click();
      await expect(page).toHaveURL("/login");
    }
    for (let n = 0; n < 5; n++) {
      await signOut();
      await keyLogin(n);
    }
    await page.goto("/settings/security");
    if (!enabled) {
      await page
        .getByRole("button", { name: "Disable key login", exact: true })
        .click();
      await expect(page).toHaveURL("/login");
      for (let n = 0; n < 5; n++) {
        await useKey(n);
        await page.getByLabel("Username").fill(username);
        await page
          .getByRole("button", { name: "Use registered key", exact: true })
          .click();
        await expect(page.getByRole("alert")).toContainText("unavailable");
      }
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL("/");
    }
    for (let n = 0; n < 5; n++) {
      if (enabled) await useKey(n); // The target authorizes its own deletion.
      await page.goto("/settings/security");
      const older = await browser.newContext({
        storageState: await context.storageState(),
        baseURL: publicOrigin,
        ignoreHTTPSErrors: true,
      });
      const olderPage = await older.newPage();
      await page
        .getByRole("button", { name: `Delete Key ${n + 1}`, exact: true })
        .focus();
      await page.keyboard.press("Enter");
      if (n === 4)
        await expect(
          page.getByText(/Deleting your final key restores password sign-in/),
        ).toBeVisible();
      if (!enabled) {
        await page
          .getByLabel("Current account password")
          .fill("incorrect password");
        await page
          .getByRole("button", { name: "Confirm deletion", exact: true })
          .click();
        await expect(page.getByRole("alert")).toContainText("removal failed");
        await expect(page.locator("main li")).toHaveCount(5 - n);
        await page.getByLabel("Current account password").fill(password);
      }
      expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
      await page
        .getByRole("button", { name: "Confirm deletion", exact: true })
        .click();
      await expect(page).toHaveURL("/login");
      await olderPage.goto("/");
      await expect(olderPage).toHaveURL("/login");
      await older.close();
      // A removed authenticator stays unavailable even though it still has its private key.
      const csrf = await page.locator('input[name="csrfToken"]').inputValue();
      const denied = await page.evaluate(
        async ({ csrf, username, id }) => {
          const start = await fetch("/key-ceremony", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "login-start",
              csrfToken: csrf,
              username,
            }),
          });
          const result = (await start.json()) as {
            options?: { allowCredentials?: { id: string }[] };
          };
          return {
            status: start.status,
            allowed: result.options?.allowCredentials?.some(
              (key) => key.id === id,
            ),
          };
        },
        {
          csrf,
          username,
          id: saved[n].credentialId
            .replace(/\+/g, "-")
            .replace(/\//g, "_")
            .replace(/=+$/, ""),
        },
      );
      if (enabled && n < 4) {
        expect(denied.allowed).toBe(false);
        for (let remaining = n + 1; remaining < 5; remaining++) {
          if (remaining > n + 1) await signOut();
          await keyLogin(remaining);
        }
      } else {
        expect(denied.status).toBe(400);
        await page.getByLabel("Username").fill(username);
        await page.getByLabel("Password", { exact: true }).fill(password);
        await page
          .getByRole("button", { name: "Sign in", exact: true })
          .click();
        await expect(page).toHaveURL("/");
      }
      await page.goto("/settings/security");
      await expect(page.locator("main li")).toHaveCount(4 - n);
      await expect(
        page.getByRole("heading", {
          name:
            enabled && n < 4
              ? "Key login is enabled"
              : "Password login is enabled",
        }),
      ).toBeVisible();
    }
    await expect(
      page.getByRole("button", { name: "Re-enable key login", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Enroll and enable key login" }),
    ).toBeVisible();
    await cdp.detach();
  });
}
