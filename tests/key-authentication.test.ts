import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { users } from "../app/database/schema.server";
import { afterEach, expect, test, vi } from "vitest";
import { AuthenticationService } from "../app/auth/authentication.server";
import { openApplicationDatabase } from "../app/database/database.server";
import { GoalSetupService } from "../app/setup/goal-setup.server";
import { authenticator } from "./support/webauthn";
import { seedAuthenticatedAccount } from "./support/authentication";

const cleanup: (() => Promise<void>)[] = [];
const password = "correct horse battery staple";
afterEach(async () => {
  vi.unstubAllEnvs();
  for (const close of cleanup.splice(0)) await close();
});
async function fixture() {
  vi.stubEnv("APPLICATION_URL", "https://tracker.example");
  vi.stubEnv("WEBAUTHN_ENROLLMENT_PREVIEW", "1");
  const directory = await mkdtemp(path.join(tmpdir(), "key-auth-"));
  const database = openApplicationDatabase({
    databasePath: path.join(directory, "app.sqlite"),
    migrationsFolder: path.resolve("drizzle"),
  });
  cleanup.push(async () => {
    database.close();
    await rm(directory, { recursive: true, force: true });
  });
  let now = new Date("2026-09-13T19:00:00.000Z");
  const service = new AuthenticationService(database.getClient(), () => now);
  const session = await seedAuthenticatedAccount(
    service,
    database.getClient(),
    "owner",
    password,
    "192.0.2.1",
    "admin",
  );
  const setup = new GoalSetupService(database.getClient());
  setup.completeInitial(session.user.id, {
    displayUnits: "us",
    timeZone: "UTC",
    calorieTargetMilliKcal: 2_000_000,
    carbohydrateTargetMilligrams: 200_000,
    fatTargetMilligrams: 60_000,
    fiberTargetMilligrams: 30_000,
    proteinTargetMilligrams: 100_000,
    sodiumMaximumMilligrams: 2_000,
    sugarMaximumMilligrams: 40_000,
    waterTargetMicroliters: 2_000_000,
  });
  return {
    database,
    service,
    session,
    advance(ms: number) {
      now = new Date(now.getTime() + ms);
    },
  };
}

test("first enrollment requires a live setup-complete session and leaves password login usable before proof", async () => {
  const { service, session } = await fixture();
  await expect(
    service.keys.beginEnrollment("missing", "browser", "My YubiKey"),
  ).rejects.toThrow();
  const options = await service.keys.beginEnrollment(
    session.token,
    "browser",
    "My YubiKey",
  );
  expect(options.rp).toEqual({
    name: "Open Calorie Tracker",
    id: "tracker.example",
  });
  expect(options.authenticatorSelection?.userVerification).toBe("required");
  expect(
    options.authenticatorSelection?.authenticatorAttachment,
  ).toBeUndefined();
  expect((await service.login("owner", password, "192.0.2.2")).ok).toBe(true);
});

test("registration plus assertion enables key login, retains the password and revokes old sessions", async () => {
  const { service, session } = await fixture();
  const key = authenticator();
  const options = await service.keys.beginEnrollment(
    session.token,
    "browser",
    "My YubiKey",
  );
  const proof = await service.keys.finishRegistration(
    session.token,
    "browser",
    key.registration(options),
  );
  expect((await service.login("owner", password, "192.0.2.2")).ok).toBe(true);
  const enabled = await service.keys.finishEnrollment(
    session.token,
    "browser",
    key.assertion(proof),
  );
  expect(enabled.user.role).toBe("admin");
  expect(enabled.absoluteExpiresAt).toEqual(session.absoluteExpiresAt);
  expect(await service.authenticate(session.token)).toBeUndefined();
  expect((await service.login("owner", password, "192.0.2.2")).ok).toBe(false);
  const request = await service.keys.beginLogin(
    "owner",
    "login-browser",
    "192.0.2.3",
  );
  const signedIn = await service.keys.finishLogin(
    "login-browser",
    key.assertion(request, 2),
  );
  expect((await service.authenticate(signedIn.token))?.user.username).toBe(
    "owner",
  );
});

async function enroll(
  service: AuthenticationService,
  token: string,
  browser = "enroll",
) {
  const key = authenticator();
  const options = await service.keys.beginEnrollment(
    token,
    browser,
    "Proton Pass",
  );
  const proof = await service.keys.finishRegistration(
    token,
    browser,
    key.registration(options),
  );
  const session = await service.keys.finishEnrollment(
    token,
    browser,
    key.assertion(proof),
  );
  return { key, session };
}

test("password reset preserves key mode but invalidates an outstanding login proof", async () => {
  const { service, database } = await fixture();
  const member = await seedAuthenticatedAccount(
    service,
    database.getClient(),
    "member",
    password,
    "192.0.2.5",
  );
  new GoalSetupService(database.getClient()).completeInitial(member.user.id, {
    displayUnits: "us",
    timeZone: "UTC",
    calorieTargetMilliKcal: 2_000_000,
    carbohydrateTargetMilligrams: 200_000,
    fatTargetMilligrams: 60_000,
    fiberTargetMilligrams: 30_000,
    proteinTargetMilligrams: 100_000,
    sodiumMaximumMilligrams: 2_000,
    sugarMaximumMilligrams: 40_000,
    waterTargetMicroliters: 2_000_000,
  });
  const { key } = await enroll(service, member.token);
  const pending = await service.keys.beginLogin(
    "member",
    "pending",
    "192.0.2.6",
  );
  await service.resetMemberPassword(
    { id: 1, role: "admin", username: "owner", passwordChangeRequired: false },
    "member",
    "new temporary password",
  );
  await expect(
    service.keys.finishLogin("pending", key.assertion(pending, 2)),
  ).rejects.toThrow();
  expect(
    (await service.login("member", "new temporary password", "192.0.2.7")).ok,
  ).toBe(false);
  const fresh = await service.keys.beginLogin("member", "fresh", "192.0.2.6");
  const session = await service.keys.finishLogin(
    "fresh",
    key.assertion(fresh, 3),
  );
  expect(session.user.passwordChangeRequired).toBe(true);
});

test.each([
  ["missing user verification", { flags: 1 }],
  ["missing user presence", { flags: 4 }],
  ["wrong origin", { origin: "https://attacker.example" }],
  ["wrong RP", { rpId: "attacker.example" }],
  ["wrong challenge", { challenge: "wrong-challenge" }],
  ["wrong signature", { badSignature: true }],
  ["wrong user handle", { userHandle: "other-account" }],
] as const)(
  "rejects %s, burns the challenge, and allows a fresh key login",
  async (_name, overrides) => {
    const { service, session } = await fixture();
    const { key } = await enroll(service, session.token);
    const options = await service.keys.beginLogin(
      "owner",
      "login",
      "192.0.2.9",
    );
    await expect(
      service.keys.finishLogin("login", key.assertion(options, 2, overrides)),
    ).rejects.toThrow();
    await expect(
      service.keys.finishLogin("login", key.assertion(options, 2)),
    ).rejects.toThrow();
    const fresh = await service.keys.beginLogin("owner", "login", "192.0.2.9");
    expect(
      (await service.keys.finishLogin("login", key.assertion(fresh, 2))).user
        .username,
    ).toBe("owner");
  },
);

test.each([
  ["touch-only registration", { flags: 0x41 }],
  ["absent user presence", { flags: 0x44 }],
  ["wrong registration origin", { origin: "https://attacker.example" }],
  ["wrong registration RP", { rpId: "attacker.example" }],
  ["wrong registration challenge", { challenge: "wrong-challenge" }],
] as const)("%s cannot enable or save a key", async (_name, overrides) => {
  const { service, session } = await fixture();
  const key = authenticator();
  const options = await service.keys.beginEnrollment(
    session.token,
    "enroll",
    "Test key",
  );
  await expect(
    service.keys.finishRegistration(
      session.token,
      "enroll",
      key.registration(options, overrides),
    ),
  ).rejects.toThrow();
  await expect(
    service.keys.finishRegistration(
      session.token,
      "enroll",
      key.registration(options),
    ),
  ).rejects.toThrow();
  expect(service.keys.status(session.token)).toEqual({
    enabled: false,
    credentials: [],
  });
  expect((await service.login("owner", password, "192.0.2.2")).ok).toBe(true);
});

test("expiry, cancellation, wrong browser and wrong purpose do not grant authority", async () => {
  const f = await fixture();
  const key = authenticator();
  let options = await f.service.keys.beginEnrollment(
    f.session.token,
    "enroll",
    "My key",
  );
  await expect(
    f.service.keys.finishRegistration(
      f.session.token,
      "wrong-browser",
      key.registration(options),
    ),
  ).rejects.toThrow();
  f.service.keys.cancel("enroll");
  await expect(
    f.service.keys.finishRegistration(
      f.session.token,
      "enroll",
      key.registration(options),
    ),
  ).rejects.toThrow();
  options = await f.service.keys.beginEnrollment(
    f.session.token,
    "enroll",
    "My key",
  );
  f.advance(300_001);
  await expect(
    f.service.keys.finishRegistration(
      f.session.token,
      "enroll",
      key.registration(options),
    ),
  ).rejects.toThrow();
  options = await f.service.keys.beginEnrollment(
    f.session.token,
    "enroll",
    "My key",
  );
  const proof = await f.service.keys.finishRegistration(
    f.session.token,
    "enroll",
    key.registration(options),
  );
  await expect(
    f.service.keys.finishLogin("enroll", key.assertion(proof)),
  ).rejects.toThrow();
  expect(f.service.keys.status(f.session.token).enabled).toBe(false);
});

test("another account cannot complete enrollment and no partial key survives a failed assertion", async () => {
  const { database, service, session } = await fixture();
  const other = await seedAuthenticatedAccount(
    service,
    database.getClient(),
    "other",
    password,
    "192.0.2.10",
  );
  const key = authenticator();
  const options = await service.keys.beginEnrollment(
    session.token,
    "enroll",
    "My key",
  );
  await expect(
    service.keys.finishRegistration(
      other.token,
      "enroll",
      key.registration(options),
    ),
  ).rejects.toThrow();
  const fresh = await service.keys.beginEnrollment(
    session.token,
    "enroll",
    "My key",
  );
  const proof = await service.keys.finishRegistration(
    session.token,
    "enroll",
    key.registration(fresh),
  );
  await expect(
    service.keys.finishEnrollment(
      session.token,
      "enroll",
      key.assertion(proof, 1, { badSignature: true }),
    ),
  ).rejects.toThrow();
  expect(service.keys.status(session.token)).toEqual({
    enabled: false,
    credentials: [],
  });
});

test("concurrent enabling and assertions issue access once and cannot overwrite newer credential state", async () => {
  const { service, session } = await fixture();
  const key = authenticator();
  const first = await service.keys.beginEnrollment(
    session.token,
    "first",
    "Key",
  );
  const second = await service.keys.beginEnrollment(
    session.token,
    "second",
    "Key",
  );
  expect(first.user.id).toBe(second.user.id);
  const a = await service.keys.finishRegistration(
    session.token,
    "first",
    key.registration(first),
  );
  const b = await service.keys.finishRegistration(
    session.token,
    "second",
    key.registration(second),
  );
  const enabled = await Promise.allSettled([
    service.keys.finishEnrollment(session.token, "first", key.assertion(a)),
    service.keys.finishEnrollment(session.token, "second", key.assertion(b)),
  ]);
  expect(
    enabled.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const p = await service.keys.beginLogin("owner", "p", "192.0.2.1");
  const q = await service.keys.beginLogin("owner", "q", "192.0.2.1");
  const logins = await Promise.allSettled([
    service.keys.finishLogin("p", key.assertion(p, 2)),
    service.keys.finishLogin("q", key.assertion(q, 3)),
  ]);
  expect(logins.filter((result) => result.status === "fulfilled")).toHaveLength(
    1,
  );
  const replay = await service.keys.beginLogin("owner", "replay", "192.0.2.1");
  const twice = await Promise.allSettled([
    service.keys.finishLogin("replay", key.assertion(replay, 4)),
    service.keys.finishLogin("replay", key.assertion(replay, 4)),
  ]);
  expect(twice.filter((result) => result.status === "fulfilled")).toHaveLength(
    1,
  );
});

test("password changes, disablement and deletion supersede in-flight ceremonies", async () => {
  const { service, database, session } = await fixture();
  const key = authenticator();
  const options = await service.keys.beginEnrollment(
    session.token,
    "enroll",
    "Key",
  );
  const changed = await service.changePassword(
    session,
    password,
    "replacement account password",
  );
  expect(changed.ok).toBe(true);
  await expect(
    service.keys.finishRegistration(
      session.token,
      "enroll",
      key.registration(options),
    ),
  ).rejects.toThrow();
  if (!changed.ok) throw new Error("password change failed");
  const { key: activeKey } = await enroll(service, changed.session.token);
  const login = await service.keys.beginLogin("owner", "login", "192.0.2.1");
  database
    .getClient()
    .update(users)
    .set({ accessState: "disabled" })
    .where(eq(users.id, session.user.id))
    .run();
  await expect(
    service.keys.finishLogin("login", activeKey.assertion(login, 2)),
  ).rejects.toThrow();
  await expect(
    service.keys.beginLogin("owner", "new", "192.0.2.1"),
  ).rejects.toThrow();
  database.getClient().delete(users).where(eq(users.id, session.user.id)).run();
  expect(await service.authenticate(changed.session.token)).toBeUndefined();
  await expect(
    service.keys.beginLogin("owner", "new", "192.0.2.1"),
  ).rejects.toThrow();
});

test("rate limits survive service recreation and enrollment preview is off by default", async () => {
  const { service, database, session } = await fixture();
  vi.stubEnv("WEBAUTHN_ENROLLMENT_PREVIEW", "");
  await expect(
    service.keys.beginEnrollment(session.token, "enroll", "Key"),
  ).rejects.toThrow("preview");
  vi.stubEnv("WEBAUTHN_ENROLLMENT_PREVIEW", "1");
  await expect(
    service.keys.beginEnrollment(session.token, "enroll", " "),
  ).rejects.toThrow();
  for (let n = 0; n < 20; n++)
    await expect(
      service.keys.beginLogin("missing", "login", "192.0.2.1"),
    ).rejects.toThrow();
  await expect(
    new AuthenticationService(
      database.getClient(),
      () => new Date("2026-09-13T19:00:00.000Z"),
    ).keys.beginLogin("missing", "login", "192.0.2.1"),
  ).rejects.toThrow("Too many");
  for (let n = 0; n < 10; n++)
    await service.keys.beginEnrollment(session.token, "enroll", "Key");
  await expect(
    service.keys.beginEnrollment(session.token, "enroll", "Key"),
  ).rejects.toThrow("Too many");
});

test("zero-counter authenticators can sign in repeatedly with new single-use challenges", async () => {
  const { service, session } = await fixture();
  const key = authenticator();
  const options = await service.keys.beginEnrollment(
    session.token,
    "enroll",
    "Proton Pass",
  );
  const proof = await service.keys.finishRegistration(
    session.token,
    "enroll",
    key.registration(options),
  );
  await service.keys.finishEnrollment(
    session.token,
    "enroll",
    key.assertion(proof, 0),
  );
  for (let n = 0; n < 2; n++) {
    const request = await service.keys.beginLogin(
      "owner",
      "login",
      "192.0.2.1",
    );
    expect(
      (await service.keys.finishLogin("login", key.assertion(request, 0))).user
        .username,
    ).toBe("owner");
  }
});

test("member disable during cryptographic verification prevents stale issuance across database connections", async () => {
  const { service, database, session } = await fixture();
  const member = await seedAuthenticatedAccount(
    service,
    database.getClient(),
    "race.member",
    password,
    "192.0.2.5",
  );
  new GoalSetupService(database.getClient()).completeInitial(member.user.id, {
    displayUnits: "us",
    timeZone: "UTC",
    calorieTargetMilliKcal: 2_000_000,
    carbohydrateTargetMilligrams: 200_000,
    fatTargetMilligrams: 60_000,
    fiberTargetMilligrams: 30_000,
    proteinTargetMilligrams: 100_000,
    sodiumMaximumMilligrams: 2_000,
    sugarMaximumMilligrams: 40_000,
    waterTargetMicroliters: 2_000_000,
  });
  const { key, session: enabled } = await enroll(service, member.token);
  const other = openApplicationDatabase({
    databasePath: database.getClient().$client.name,
    migrationsFolder: path.resolve("drizzle"),
  });
  try {
    const otherService = new AuthenticationService(other.getClient());
    const pending = await service.keys.beginLogin(
      "race.member",
      "login",
      "192.0.2.1",
    );
    const signingIn = service.keys.finishLogin(
      "login",
      key.assertion(pending, 2),
    );
    await otherService.disableMemberAccess(
      session.user,
      "race.member",
      "race.member",
    );
    await expect(signingIn).rejects.toThrow();
    expect(await service.authenticate(enabled.token)).toBeUndefined();
    await otherService.reactivateMemberAccess(session.user, "race.member");
    expect((await service.login("race.member", password, "192.0.2.1")).ok).toBe(
      false,
    );
    await expect(
      service.keys.finishLogin("login", key.assertion(pending, 2)),
    ).rejects.toThrow();
  } finally {
    other.close();
  }
});

test("first enrollment rejects mandatory-password accounts, expired sessions and HTTP LAN application origins", async () => {
  const f = await fixture();
  const provisioned = await f.service.provisionMember(
    "unready.member",
    password,
  );
  expect(provisioned.ok).toBe(true);
  const login = await f.service.login("unready.member", password, "192.0.2.8");
  if (!login.ok) throw new Error("member login failed");
  await expect(
    f.service.keys.beginEnrollment(login.session.token, "browser", "Key"),
  ).rejects.toThrow("setup");
  vi.stubEnv("APPLICATION_URL", "http://192.168.4.21:3002");
  await expect(
    f.service.keys.beginEnrollment(f.session.token, "browser", "Key"),
  ).rejects.toThrow("HTTPS");
  vi.stubEnv("APPLICATION_URL", "https://tracker.example");
  f.advance(5 * 24 * 60 * 60_000 + 1);
  await expect(
    f.service.keys.beginEnrollment(f.session.token, "browser", "Key"),
  ).rejects.toThrow("Sign in");
});

test("database failure during enabling rolls back mode and credentials, while the submitted proof stays burned", async () => {
  const { service, database, session } = await fixture();
  const key = authenticator();
  const start = await service.keys.beginEnrollment(
    session.token,
    "enroll",
    "Key",
  );
  const proof = await service.keys.finishRegistration(
    session.token,
    "enroll",
    key.registration(start),
  );
  database
    .getClient()
    .$client.exec(
      "CREATE TRIGGER refuse_key_session BEFORE INSERT ON sessions BEGIN SELECT RAISE(ABORT, 'fixture storage failure'); END",
    );
  await expect(
    service.keys.finishEnrollment(
      session.token,
      "enroll",
      key.assertion(proof),
    ),
  ).rejects.toThrow();
  database.getClient().$client.exec("DROP TRIGGER refuse_key_session");
  expect(service.keys.status(session.token)).toEqual({
    enabled: false,
    credentials: [],
  });
  expect((await service.login("owner", password, "192.0.2.2")).ok).toBe(true);
  await expect(
    service.keys.finishEnrollment(
      session.token,
      "enroll",
      key.assertion(proof),
    ),
  ).rejects.toThrow();
});

test("localhost development credentials remain separate from production and exact public origin changes invalidate pending proof", async () => {
  const f = await fixture();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("APPLICATION_URL", "http://localhost:3000");
  await expect(
    f.service.keys.beginEnrollment(f.session.token, "browser", "Local key"),
  ).rejects.toThrow("HTTPS");
  vi.stubEnv("NODE_ENV", "development");
  const local = await f.service.keys.beginEnrollment(
    f.session.token,
    "browser",
    "Local key",
  );
  expect(local.rp.id).toBe("localhost");
  const key = authenticator();
  vi.stubEnv("APPLICATION_URL", "https://tracker.example");
  await expect(
    f.service.keys.finishRegistration(
      f.session.token,
      "browser",
      key.registration(local, { origin: "http://localhost:3000" }),
    ),
  ).rejects.toThrow("changed");
  expect((await f.service.login("owner", password, "192.0.2.2")).ok).toBe(true);
});

test("credentials without transport hints or assertion user handles still require verified ownership", async () => {
  const { service, session } = await fixture();
  const key = authenticator();
  const start = await service.keys.beginEnrollment(
    session.token,
    "enroll",
    "Passkey",
  );
  const response = key.registration(start);
  delete response.response.transports;
  const proof = await service.keys.finishRegistration(
    session.token,
    "enroll",
    response,
  );
  const assertion = key.assertion(proof);
  delete assertion.response.userHandle;
  const enabled = await service.keys.finishEnrollment(
    session.token,
    "enroll",
    assertion,
  );
  await expect(
    service.keys.beginEnrollment(enabled.token, "enroll", "Another"),
  ).rejects.toThrow("already enabled");
  const request = await service.keys.beginLogin("owner", "login", "192.0.2.1");
  const login = key.assertion(request, 2);
  delete login.response.userHandle;
  expect((await service.keys.finishLogin("login", login)).user.username).toBe(
    "owner",
  );
});
