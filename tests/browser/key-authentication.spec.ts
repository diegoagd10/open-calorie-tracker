import AxeBuilder from "@axe-core/playwright";
import {
  bootstrapOrSignInBrowserTestUser,
  signInProvisionedMember,
  expect,
  test,
} from "./reset-database";

const password = "correct horse battery staple";
test("first key enrollment and username/key login use real WebAuthn and replace password access", async ({
  context,
  page,
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "Virtual authenticators use Chromium CDP on the public HTTPS entry.",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send(
    "WebAuthn.addVirtualAuthenticator",
    {
      options: {
        protocol: "ctap2",
        transport: "usb",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    },
  );
  await bootstrapOrSignInBrowserTestUser(page, "key.owner", password);
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL("/");
  const older = await browser.newContext({
    baseURL: "https://localhost:4173",
    ignoreHTTPSErrors: true,
  });
  const otherPage = await older.newPage();
  await otherPage.goto("/login");
  await otherPage.getByLabel("Username").fill("key.owner");
  await otherPage.getByLabel("Password", { exact: true }).fill(password);
  await otherPage.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(otherPage).toHaveURL("/");
  await page.goto("/settings/security");
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByLabel("Key name").fill("My YubiKey");
  await page
    .getByRole("button", { name: "Enroll and enable key login" })
    .focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("heading", { name: "Key login is enabled" }),
  ).toBeVisible();
  await expect(page.getByText("My YubiKey", { exact: true })).toBeVisible();
  await otherPage.goto("/");
  await expect(otherPage).toHaveURL("/login");
  await older.close();
  // Logout retains the key and clears only this session.
  await page.goto("/settings/goals");
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL("/login");
  await page.getByLabel("Username").fill("key.owner");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("incorrect");
  await page.getByLabel("Password", { exact: true }).fill("");
  await page
    .getByRole("button", { name: "Use registered key", exact: true })
    .click();
  await expect(page).toHaveURL("/");
  expect(
    (await cdp.send("WebAuthn.getCredentials", { authenticatorId }))
      .credentials,
  ).toHaveLength(1);
  await page.goto("http://127.0.0.1:4174/login");
  await expect(
    page.getByRole("link", { name: "Use key sign-in on public HTTPS" }),
  ).toHaveAttribute("href", "https://localhost:4173/login");
  await expect(
    page.getByRole("button", { name: "Use registered key" }),
  ).toHaveCount(0);
  await cdp.detach();
});

test("cancelled enrollment leaves password mode usable and permits retry", async ({
  context,
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "Virtual authenticator cancellation uses Chromium CDP.",
  );
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  const { authenticatorId } = await cdp.send(
    "WebAuthn.addVirtualAuthenticator",
    {
      options: {
        protocol: "ctap2",
        transport: "usb",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: false,
      },
    },
  );
  await bootstrapOrSignInBrowserTestUser(page, "cancel.owner", password);
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/settings/security");
  await page.getByLabel("Key name").fill("Proton Pass");
  await page
    .getByRole("button", { name: "Enroll and enable key login" })
    .click();
  await page
    .getByRole("button", { name: "Cancel key prompt" })
    .click({ timeout: 5000 });
  await expect(page.getByRole("alert")).toContainText(/cancelled|retry/i);
  await expect(
    page.getByRole("heading", { name: "Password login is enabled" }),
  ).toBeVisible();
  await cdp.send("WebAuthn.setAutomaticPresenceSimulation", {
    authenticatorId,
    enabled: true,
  });
  await page
    .getByRole("button", { name: "Enroll and enable key login" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Key login is enabled" }),
  ).toBeVisible();
  await cdp.detach();
});

test("six virtual authenticators enroll with fresh proof, reject duplicate/cross-account enrollment, and each signs in", async ({
  context,
  page,
  browser,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "chromium",
    "Real virtual authenticator ceremonies use Chromium CDP.",
  );
  await page.setViewportSize({ width: 390, height: 844 });
  const cdp = await context.newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  let activeId = "";
  async function addKey(presence = true) {
    if (activeId)
      await cdp.send("WebAuthn.removeVirtualAuthenticator", {
        authenticatorId: activeId,
      });
    const { authenticatorId } = await cdp.send(
      "WebAuthn.addVirtualAuthenticator",
      {
        options: {
          protocol: "ctap2",
          transport: "usb",
          hasResidentKey: true,
          hasUserVerification: true,
          isUserVerified: true,
          automaticPresenceSimulation: presence,
        },
      },
    );
    activeId = authenticatorId;
  }
  await addKey();
  const saved = (
    await cdp.send("WebAuthn.getCredentials", { authenticatorId: activeId })
  ).credentials;
  async function rememberKey() {
    return (
      await cdp.send("WebAuthn.getCredentials", { authenticatorId: activeId })
    ).credentials[0];
  }
  await bootstrapOrSignInBrowserTestUser(page, "multiple.owner", password);
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/settings/security");
  await page.getByLabel("Key name").fill("Key 1");
  await page
    .getByRole("button", { name: "Enroll and enable key login" })
    .click();
  await expect(page.getByText("Key 1", { exact: true })).toBeVisible();
  saved.push(await rememberKey());
  for (let n = 2; n <= 6; n++) {
    // Unplug the proven authenticator and plug in a fresh one before registration.
    await page.route("**/key-ceremony", async (route) => {
      if (
        (route.request().postDataJSON() as { action: string }).action !==
        "addition-finish"
      )
        return route.continue();
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      saved[saved.length - 1] = await rememberKey();
      await addKey();
      await route.fulfill({ response });
    });
    await page.getByLabel("Key name").fill(`Key ${n}`);
    await page.getByRole("button", { name: "Add another key" }).click();
    await expect(page.getByText(`Key ${n}`, { exact: true })).toBeVisible();
    await page.unroute("**/key-ceremony");
    saved.push(await rememberKey());
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  // The actual authenticator refuses registration of an excluded credential.
  await page.getByLabel("Key name").fill("Duplicate");
  const duplicateProof = page.waitForResponse(
    (response) =>
      response.url().endsWith("/key-ceremony") &&
      (response.request().postDataJSON() as { action: string }).action ===
        "addition-finish",
  );
  await page.getByRole("button", { name: "Add another key" }).click();
  expect((await duplicateProof).status()).toBe(200);
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.locator("main li")).toHaveCount(6);
  // Cancel registration after a successful fresh ownership proof.
  await page.route("**/key-ceremony", async (route) => {
    if (
      (route.request().postDataJSON() as { action: string }).action !==
      "addition-finish"
    )
      return route.continue();
    const response = await route.fetch();
    saved[saved.length - 1] = await rememberKey();
    await addKey(false);
    await route.fulfill({ response });
  });
  await page.getByLabel("Key name").fill("Cancelled backup");
  const authorized = page.waitForResponse(
    (response) =>
      response.url().endsWith("/key-ceremony") &&
      (response.request().postDataJSON() as { action: string }).action ===
        "addition-finish",
  );
  await page.getByRole("button", { name: "Add another key" }).click();
  expect((await authorized).status()).toBe(200);
  await page.getByRole("button", { name: "Cancel key prompt" }).click();
  await expect(page.getByRole("alert")).toContainText(/cancelled|retry/i);
  await page.unroute("**/key-ceremony");
  await page.reload();
  await expect(page.locator("main li")).toHaveCount(6);
  for (let n = 0; n < saved.length; n++) {
    await addKey();
    await cdp.send("WebAuthn.addCredential", {
      authenticatorId: activeId,
      credential: saved[n],
    });
    await page.goto("/settings/goals");
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByLabel("Username").fill("multiple.owner");
    await page
      .getByRole("button", { name: "Use registered key", exact: true })
      .click();
    await expect(page).toHaveURL("/");
    saved[n] = await rememberKey();
  }
  // Repeat the lifecycle with the first and sixth saved keys.
  for (const n of [0, 5]) {
    await addKey();
    await cdp.send("WebAuthn.addCredential", { authenticatorId: activeId, credential: saved[n] });
    await page.goto("/settings/security");
    const olderKey = await browser.newContext({ storageState: await context.storageState(), baseURL: "https://localhost:4173", ignoreHTTPSErrors: true });
    const olderKeyPage = await olderKey.newPage();
    await page.getByRole("button", { name: "Disable key login", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL("/login");
    await olderKeyPage.goto("/");
    await expect(olderKeyPage).toHaveURL("/login");
    await olderKey.close();
    await page.getByLabel("Username").fill("multiple.owner");
    await page.getByRole("button", { name: "Use registered key", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText("unavailable");
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL("/");
    await page.goto("/settings/security");
    await expect(page.getByText(/Your keys are retained/)).toBeVisible();
    await expect(page.locator("main li")).toHaveCount(6);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    const olderPassword = await browser.newContext({ storageState: await context.storageState(), baseURL: "https://localhost:4173", ignoreHTTPSErrors: true });
    const olderPasswordPage = await olderPassword.newPage();
    const lanPassword = await browser.newContext({ baseURL: "http://127.0.0.1:4174" });
    const lanPage = await lanPassword.newPage();
    await lanPage.goto("/login");
    await lanPage.getByLabel("Username").fill("multiple.owner");
    await lanPage.getByLabel("Password", { exact: true }).fill(password);
    await lanPage.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(lanPage).toHaveURL("/");
    await cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId: activeId, enabled: false });
    await page.getByRole("button", { name: "Re-enable key login", exact: true }).click();
    await page.getByRole("button", { name: "Cancel key prompt" }).click();
    await expect(page.getByRole("alert")).toContainText(/cancelled|retry/i);
    await expect(page.getByRole("heading", { name: "Password login is enabled" })).toBeVisible();
    await cdp.send("WebAuthn.setAutomaticPresenceSimulation", { authenticatorId: activeId, enabled: true });
    await page.getByRole("button", { name: "Re-enable key login", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Key login is enabled" })).toBeVisible();
    await olderPasswordPage.goto("/");
    await expect(olderPasswordPage).toHaveURL("/login");
    await lanPage.goto("/");
    await expect(lanPage).toHaveURL("/login");
    await olderPassword.close();
    await lanPassword.close();
    saved[n] = await rememberKey();
  }
  // Ask the member's browser for an owner's key, then submit its real signature
  // against the member's addition challenge to prove the server denies foreign keys.
  await page.goto("/settings/goals");
  await page.getByRole("button", { name: "Sign out" }).click();
  await addKey();
  await signInProvisionedMember(page, "multiple.member", password);
  await page.getByRole("button", { name: "Finish setup" }).click();
  await expect(page).toHaveURL("/");
  await page.goto("/settings/security");
  await page.getByLabel("Key name").fill("Member key");
  await page
    .getByRole("button", { name: "Enroll and enable key login" })
    .click();
  await expect(page.getByText("Member key", { exact: true })).toBeVisible();
  await expect(page.locator("main li")).toHaveCount(1);
  await addKey();
  await cdp.send("WebAuthn.addCredential", {
    authenticatorId: activeId,
    credential: saved[0],
  });
  await page.route("**/key-ceremony", async (route) => {
    if (
      (route.request().postDataJSON() as { action: string }).action !==
      "addition-start"
    )
      return route.continue();
    const response = await route.fetch();
    const result = (await response.json()) as {
      options: {
        allowCredentials: {
          type: "public-key";
          id: string;
          transports: string[];
        }[];
      };
    };
    result.options.allowCredentials = [
      {
        type: "public-key",
        id: saved[0].credentialId
          .replace(/\+/g, "-")
          .replace(/\//g, "_")
          .replace(/=+$/, ""),
        transports: ["usb"],
      },
    ];
    await route.fulfill({ response, json: result });
  });
  await page.getByLabel("Key name").fill("Unauthorized backup");
  await page.getByRole("button", { name: "Add another key" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "existing registered key",
  );
  await page.unroute("**/key-ceremony");
  await page.reload();
  await expect(page.locator("main li")).toHaveCount(1);
  await cdp.detach();
});
