import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { eq } from "drizzle-orm";
import { users, webauthnCeremonies } from "../app/database/schema.server";
import { AdministratorRecoveryService } from "../app/auth/administrator-recovery.server";
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

test("a key can authorize its own final deletion, revoke pending login, and restore passwords", async () => {
  const f = await fixture();
  const { key, session } = await enroll(f.service, f.session.token);
  const login = await f.service.keys.beginLogin("owner", "pending", "192.0.2.3");
  const proof = await f.service.keys.beginRemoval(session.token, "remove", key.id);
  expect(proof.options?.allowCredentials?.map((key) => key.id)).toEqual([key.id]);
  await f.service.keys.finishRemoval(session.token, "remove", key.id, key.assertion(proof.options!, 2));
  expect(await f.service.authenticate(session.token)).toBeUndefined();
  await expect(f.service.keys.finishLogin("pending", key.assertion(login, 3))).rejects.toThrow();
  const signedIn = await f.service.login("owner", password, "192.0.2.4");
  if (!signedIn.ok) throw new Error("password login failed");
  expect(f.service.keys.status(signedIn.session.token)).toEqual({ enabled: false, credentials: [] });
  await expect(f.service.keys.beginModeChange(signedIn.session.token, "enable", true)).rejects.toThrow("first key");
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

test("administrator password recovery burns pending key proofs while preserving key mode and replacement restrictions", async () => {
  const { service, database, session } = await fixture();
  const { key } = await enroll(service, session.token);
  const pending = await service.keys.beginLogin("owner", "stale", "192.0.2.1");
  const before = database.getClient().select().from(users).get()!;
  await expect(
    new AdministratorRecoveryService(
      database.getClient(),
      undefined,
      () => "administrator recovery temporary password",
    ).recover(),
  ).resolves.toMatchObject({ ok: true });
  expect(database.getClient().select().from(webauthnCeremonies).all()).toEqual(
    [],
  );
  expect(database.getClient().select().from(users).get()).toMatchObject({
    keyLoginEnabled: true,
    passwordChangeRequired: true,
    authenticationVersion: before.authenticationVersion + 1,
  });
  await expect(
    service.keys.finishLogin("stale", key.assertion(pending, 2)),
  ).rejects.toThrow();
  expect(
    await service.login(
      "owner",
      "administrator recovery temporary password",
      "192.0.2.2",
    ),
  ).toMatchObject({ ok: false });
  const fresh = await service.keys.beginLogin("owner", "fresh", "192.0.2.1");
  await expect(
    service.keys.finishLogin("fresh", key.assertion(fresh, 2)),
  ).resolves.toMatchObject({ user: { passwordChangeRequired: true } });
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
  ).rejects.toThrow("Verify an existing key");
  const request = await service.keys.beginLogin("owner", "login", "192.0.2.1");
  const login = key.assertion(request, 2);
  delete login.response.userHandle;
  expect((await service.keys.finishLogin("login", login)).user.username).toBe(
    "owner",
  );
});

test("six named keys require fresh addition proof and every key can sign in", async () => {
  const { service, session } = await fixture();
  const first = await enroll(service, session.token);
  let current = first.session;
  const keys = [first.key];
  await expect(
    service.keys.beginEnrollment(current.token, "unproved", "Backup"),
  ).rejects.toThrow();
  for (let i = 1; i < 6; i++) {
    const authorization = await service.keys.beginAddition(
      current.token,
      "addition",
      `Backup ${i}`,
    );
    const registration = await service.keys.finishAdditionProof(
      current.token,
      "addition",
      keys[i - 1].assertion(authorization, 2),
    );
    const key = authenticator();
    const verification = await service.keys.finishRegistration(
      current.token,
      "addition",
      key.registration(registration),
    );
    current = await service.keys.finishEnrollment(
      current.token,
      "addition",
      key.assertion(verification),
    );
    keys.push(key);
  }
  expect(
    service.keys.status(current.token).credentials.map((key) => key.name),
  ).toEqual([
    "Proton Pass",
    "Backup 1",
    "Backup 2",
    "Backup 3",
    "Backup 4",
    "Backup 5",
  ]);
  for (const key of keys) {
    const options = await service.keys.beginLogin(
      "owner",
      "login",
      "192.0.2.3",
    );
    expect(options.allowCredentials).toHaveLength(6);
    const signedIn = await service.keys.finishLogin(
      "login",
      key.assertion(options, 3),
    );
    expect((await service.authenticate(signedIn.token))?.user.id).toBe(
      session.user.id,
    );
  }
});

test("cancellation during registration verification cannot recreate addition authority", async () => {
  const { service, session } = await fixture();
  const { key, session: current } = await enroll(service, session.token);
  const proof = await service.keys.beginAddition(
    current.token,
    "addition",
    "Cancelled backup",
  );
  const options = await service.keys.finishAdditionProof(
    current.token,
    "addition",
    key.assertion(proof, 2),
  );
  const backup = authenticator();
  const finishing = service.keys.finishRegistration(
    current.token,
    "addition",
    backup.registration(options),
  );
  service.keys.cancel("addition");
  await expect(finishing).rejects.toThrow();
  expect(service.keys.status(current.token).credentials).toHaveLength(1);
});

test("addition rejects unrelated proofs, another account's key, and reused or expired authorization", async () => {
  const f = await fixture();
  const { service, session } = f;
  const { key, session: current } = await enroll(service, session.token);
  const foreign = authenticator();
  const login = await service.keys.beginLogin("owner", "login", "192.0.2.4");
  await expect(
    service.keys.finishAdditionProof(
      current.token,
      "login",
      key.assertion(login, 2),
    ),
  ).rejects.toThrow();
  const proof = await service.keys.beginAddition(
    current.token,
    "foreign",
    "Foreign",
  );
  await expect(
    service.keys.finishAdditionProof(
      current.token,
      "foreign",
      foreign.assertion(proof),
    ),
  ).rejects.toThrow();
  const fresh = await service.keys.beginAddition(
    current.token,
    "fresh",
    "Expired",
  );
  const assertion = key.assertion(fresh, 2);
  await service.keys.finishAdditionProof(current.token, "fresh", assertion);
  await expect(
    service.keys.finishAdditionProof(current.token, "fresh", assertion),
  ).rejects.toThrow();
  const expiring = await service.keys.beginAddition(
    current.token,
    "expired",
    "Expired",
  );
  const options = await service.keys.finishAdditionProof(
    current.token,
    "expired",
    key.assertion(expiring, 3),
  );
  f.advance(5 * 60_000);
  await expect(
    service.keys.finishRegistration(
      current.token,
      "expired",
      foreign.registration(options),
    ),
  ).rejects.toThrow();
  expect(service.keys.status(current.token).credentials).toHaveLength(1);
});

test("duplicate credentials and policy changes cannot partially add a key", async () => {
  const { service, session, database } = await fixture();
  const { key, session: current } = await enroll(service, session.token);
  const proof = await service.keys.beginAddition(
    current.token,
    "duplicate",
    "Duplicate",
  );
  const options = await service.keys.finishAdditionProof(
    current.token,
    "duplicate",
    key.assertion(proof, 2),
  );
  expect(options.excludeCredentials?.map((key) => key.id)).toEqual([key.id]);
  const verification = await service.keys.finishRegistration(
    current.token,
    "duplicate",
    key.registration(options),
  );
  await expect(
    service.keys.finishEnrollment(
      current.token,
      "duplicate",
      key.assertion(verification, 3),
    ),
  ).rejects.toThrow();
  expect(service.keys.status(current.token).credentials).toHaveLength(1);
  const next = await service.keys.beginAddition(
    current.token,
    "changed",
    "Backup",
  );
  const registration = await service.keys.finishAdditionProof(
    current.token,
    "changed",
    key.assertion(next, 3),
  );
  const backup = authenticator();
  const pending = await service.keys.finishRegistration(
    current.token,
    "changed",
    backup.registration(registration),
  );
  database
    .getClient()
    .update(users)
    .set({ authenticationVersion: 2 })
    .where(eq(users.id, current.user.id))
    .run();
  await expect(
    service.keys.finishEnrollment(
      current.token,
      "changed",
      backup.assertion(pending),
    ),
  ).rejects.toThrow();
  expect(service.keys.status(current.token).credentials).toHaveLength(1);
});

test("adding a retained credential in password mode preserves that mode without another password", async () => {
  const { service, session, database } = await fixture();
  const { session: current } = await enroll(service, session.token);
  // Fixture for the disabled-key state, whose user-facing toggle belongs to the next slice.
  database
    .getClient()
    .update(users)
    .set({ keyLoginEnabled: false, authenticationVersion: 2 })
    .where(eq(users.id, current.user.id))
    .run();
  const key = authenticator();
  const options = await service.keys.beginEnrollment(
    current.token,
    "retained",
    "Password-mode backup",
  );
  const proof = await service.keys.finishRegistration(
    current.token,
    "retained",
    key.registration(options),
  );
  const saved = await service.keys.finishEnrollment(
    current.token,
    "retained",
    key.assertion(proof),
  );
  expect(service.keys.status(saved.token)).toMatchObject({
    enabled: false,
    credentials: [{ name: "Proton Pass" }, { name: "Password-mode backup" }],
  });
  expect((await service.login("owner", password, "192.0.2.7")).ok).toBe(true);
  await expect(
    service.keys.beginLogin("owner", "login", "192.0.2.8"),
  ).rejects.toThrow();
});

test("cancelling in-flight addition proof or final verification changes no saved keys", async () => {
  const { service, session } = await fixture();
  const { key, session: current } = await enroll(service, session.token);
  let proof = await service.keys.beginAddition(
    current.token,
    "proof",
    "Cancelled proof",
  );
  const authorizing = service.keys.finishAdditionProof(
    current.token,
    "proof",
    key.assertion(proof, 2),
  );
  service.keys.cancel("proof");
  await expect(authorizing).rejects.toThrow();
  proof = await service.keys.beginAddition(
    current.token,
    "final",
    "Cancelled final",
  );
  const registration = await service.keys.finishAdditionProof(
    current.token,
    "final",
    key.assertion(proof, 2),
  );
  const backup = authenticator();
  const verification = await service.keys.finishRegistration(
    current.token,
    "final",
    backup.registration(registration),
  );
  const finishing = service.keys.finishEnrollment(
    current.token,
    "final",
    backup.assertion(verification),
  );
  service.keys.cancel("final");
  await expect(finishing).rejects.toThrow();
  expect(service.keys.status(current.token).credentials).toHaveLength(1);
});

test("fresh addition authorization is unavailable in password mode", async () => {
  const { service, session } = await fixture();
  await expect(
    service.keys.beginAddition(session.token, "proof", "Backup"),
  ).rejects.toThrow("Retry enrollment");
  expect(service.keys.status(session.token)).toEqual({
    enabled: false,
    credentials: [],
  });
});

test("fresh key proof disables login with keys retained, and explicitly re-enables from password mode", async () => {
  const { service, session } = await fixture();
  const { key, session: enabled } = await enroll(service, session.token);
  const pendingLogin = await service.keys.beginLogin("owner", "stale-login", "192.0.2.3");
  const disable = await service.keys.beginModeChange(enabled.token, "disable", false);
  await service.keys.finishModeChange(enabled.token, "disable", false, key.assertion(disable, 2));
  expect(await service.authenticate(enabled.token)).toBeUndefined();
  await expect(service.keys.finishLogin("stale-login", key.assertion(pendingLogin, 3))).rejects.toThrow();
  await expect(service.keys.beginLogin("owner", "disabled-login", "192.0.2.3")).rejects.toThrow();
  const passwordLogin = await service.login("owner", password, "192.0.2.4");
  if (!passwordLogin.ok) throw new Error("password login failed");
  expect(service.keys.status(passwordLogin.session.token)).toMatchObject({ enabled: false, credentials: [{ id: key.id }] });
  const proof = await service.keys.beginModeChange(passwordLogin.session.token, "enable", true);
  const restored = await service.keys.finishModeChange(passwordLogin.session.token, "enable", true, key.assertion(proof, 3));
  if (!restored) throw new Error("no rotated session");
  expect(restored.absoluteExpiresAt).toEqual(passwordLogin.session.absoluteExpiresAt);
  expect(await service.authenticate(passwordLogin.session.token)).toBeUndefined();
  expect(service.keys.status(restored.token)).toMatchObject({ enabled: true, credentials: [{ id: key.id }] });
  expect((await service.login("owner", password, "192.0.2.5")).ok).toBe(false);
  const login = await service.keys.beginLogin("owner", "login", "192.0.2.3");
  expect((await service.keys.finishLogin("login", key.assertion(login, 4))).user.username).toBe("owner");
});

async function passwordMode() {
  const f = await fixture();
  const { key, session: enabled } = await enroll(f.service, f.session.token);
  const proof = await f.service.keys.beginModeChange(enabled.token, "disable", false);
  await f.service.keys.finishModeChange(enabled.token, "disable", false, key.assertion(proof, 2));
  const login = await f.service.login("owner", password, "192.0.2.2");
  if (!login.ok) throw new Error("password login failed");
  return { ...f, key, current: login.session };
}

test("removing a retained key needs fresh current password and burns incorrect attempts", async () => {
  const f = await passwordMode();
  const proof = await f.service.keys.beginRemoval(f.current.token, "remove", f.key.id);
  expect(proof.options).toBeUndefined();
  await expect(f.service.keys.finishRemoval(f.current.token, "remove", f.key.id, "incorrect password")).rejects.toThrow();
  expect(f.service.keys.status(f.current.token).credentials).toHaveLength(1);
  await expect(f.service.keys.finishRemoval(f.current.token, "remove", f.key.id, password)).rejects.toThrow();
  await f.service.keys.beginRemoval(f.current.token, "fresh", f.key.id);
  await f.service.keys.finishRemoval(f.current.token, "fresh", f.key.id, password);
  expect(await f.service.authenticate(f.current.token)).toBeUndefined();
  const login = await f.service.login("owner", password, "192.0.2.4");
  if (!login.ok) throw new Error("password login failed");
  expect(f.service.keys.status(login.session.token)).toEqual({ enabled: false, credentials: [] });
});

async function fiveKeys() {
  const f = await fixture();
  const first = await enroll(f.service, f.session.token);
  let current = first.session;
  const keys = [first.key];
  for (let n = 1; n < 5; n++) {
    const authorization = await f.service.keys.beginAddition(current.token, "addition", `Key ${n + 1}`);
    const options = await f.service.keys.finishAdditionProof(current.token, "addition", keys[n - 1].assertion(authorization, 2));
    const key = authenticator();
    const proof = await f.service.keys.finishRegistration(current.token, "addition", key.registration(options));
    current = await f.service.keys.finishEnrollment(current.token, "addition", key.assertion(proof));
    keys.push(key);
  }
  return { ...f, keys, current };
}

test.each([true, false])("five-key deletion lifecycle preserves enabled=%s until the last key and cannot resurrect keys", async (enabled) => {
  const f = await fiveKeys();
  let current = f.current;
  let counter = 10;
  async function keyLogin(key: ReturnType<typeof authenticator>) {
    const options = await f.service.keys.beginLogin("owner", "login", "192.0.2.7");
    return f.service.keys.finishLogin("login", key.assertion(options, ++counter));
  }
  for (const key of f.keys) expect((await keyLogin(key)).user.id).toBe(current.user.id);
  if (!enabled) {
    const proof = await f.service.keys.beginModeChange(current.token, "disable", false);
    await f.service.keys.finishModeChange(current.token, "disable", false, f.keys[4].assertion(proof, ++counter));
    const login = await f.service.login("owner", password, "192.0.2.8");
    if (!login.ok) throw new Error("password login failed");
    current = login.session;
  }
  for (let n = 0; n < 5; n++) {
    const proof = await f.service.keys.beginRemoval(current.token, "remove", f.keys[n].id);
    await f.service.keys.finishRemoval(current.token, "remove", f.keys[n].id, enabled ? f.keys[n].assertion(proof.options!, ++counter) : password);
    expect(await f.service.authenticate(current.token)).toBeUndefined();
    if (enabled && n < 4) {
      for (const key of f.keys.slice(n + 1)) current = await keyLogin(key);
    } else {
      const login = await f.service.login("owner", password, "192.0.2.8");
      if (!login.ok) throw new Error("password login failed");
      current = login.session;
    }
    expect(f.service.keys.status(current.token)).toMatchObject({ enabled: enabled && n < 4, credentials: f.keys.slice(n + 1).map((key) => ({ id: key.id })) });
    await expect(keyLogin(f.keys[n])).rejects.toThrow();
  }
  await expect(f.service.keys.beginModeChange(current.token, "resurrect", true)).rejects.toThrow("first key");
});

test.each(["target", "session", "owner", "purpose", "expire", "cancel", "signature", "origin", "verification", "account", "credential"])("removal rejects %s changes and burns the submitted proof", async (failure) => {
  const f = await fixture();
  const { key, session } = await enroll(f.service, f.session.token);
  const proof = await f.service.keys.beginRemoval(session.token, "remove", key.id);
  const response = (failure === "owner" ? authenticator() : key).assertion(proof.options!, 2, {
    badSignature: failure === "signature",
    origin: failure === "origin" ? "https://foreign.example" : undefined,
    flags: failure === "verification" ? 1 : undefined,
  });
  if (failure === "expire") f.advance(300_001);
  if (failure === "cancel") f.service.keys.cancel("remove");
  const finishing = failure === "purpose"
    ? f.service.keys.finishModeChange(session.token, "remove", false, response)
    : f.service.keys.finishRemoval(failure === "session" ? "foreign" : session.token, "remove", failure === "target" ? "other-target" : key.id, response);
  if (failure === "account") f.database.getClient().update(users).set({ authenticationVersion: 99 }).where(eq(users.id, session.user.id)).run();
  if (failure === "credential") f.database.getClient().$client.prepare("UPDATE webauthn_credentials SET revision = revision + 1 WHERE id = ?").run(key.id);
  await expect(finishing).rejects.toThrow();
  expect(f.service.keys.status(session.token)).toMatchObject({ enabled: true, credentials: [{ id: key.id }] });
  await expect(f.service.keys.finishRemoval(session.token, "remove", key.id, response)).rejects.toThrow();
});

test.each(["credential", "mode", "sessions", "proofs"])("failed %s storage during final deletion rolls back every mutation and burns proof", async (failure) => {
  const f = await fixture();
  const { key, session } = await enroll(f.service, f.session.token);
  const proof = await f.service.keys.beginRemoval(session.token, "remove", key.id);
  const operation = { credential: "DELETE ON webauthn_credentials", mode: "UPDATE OF key_login_enabled ON users", sessions: "DELETE ON sessions", proofs: "DELETE ON webauthn_ceremonies" }[failure]!;
  f.database.getClient().$client.exec(`CREATE TRIGGER refuse_removal BEFORE ${operation} BEGIN SELECT RAISE(ABORT, 'storage failure'); END`);
  await expect(f.service.keys.finishRemoval(session.token, "remove", key.id, key.assertion(proof.options!, 2))).rejects.toThrow();
  f.database.getClient().$client.exec("DROP TRIGGER refuse_removal");
  expect((await f.service.authenticate(session.token))?.user.id).toBe(session.user.id);
  expect(f.service.keys.status(session.token)).toMatchObject({ enabled: true, credentials: [{ id: key.id }] });
  await expect(f.service.keys.finishRemoval(session.token, "remove", key.id, key.assertion(proof.options!, 2))).rejects.toThrow();
  const retry = await f.service.keys.beginRemoval(session.token, "retry", key.id);
  await f.service.keys.finishRemoval(session.token, "retry", key.id, key.assertion(retry.options!, 2));
  expect((await f.service.login("owner", password, "192.0.2.8")).ok).toBe(true);
});

test("concurrent removals commit once, invalidate in-flight login, and preserve one usable remaining key", async () => {
  const f = await fiveKeys();
  const a = await f.service.keys.beginRemoval(f.current.token, "a", f.keys[0].id);
  const b = await f.service.keys.beginRemoval(f.current.token, "b", f.keys[1].id);
  const login = await f.service.keys.beginLogin("owner", "login", "192.0.2.8");
  const results = await Promise.allSettled([
    f.service.keys.finishRemoval(f.current.token, "a", f.keys[0].id, f.keys[0].assertion(a.options!, 10)),
    f.service.keys.finishRemoval(f.current.token, "b", f.keys[1].id, f.keys[1].assertion(b.options!, 10)),
    f.service.keys.finishLogin("login", f.keys[0].assertion(login, 11)),
  ]);
  expect(results.slice(0, 2).filter((result) => result.status === "fulfilled")).toHaveLength(1);
  const issued = results[2].status === "fulfilled" ? results[2].value : undefined;
  expect(issued ? await f.service.authenticate(issued.token) : undefined).toBeUndefined();
  const fresh = await f.service.keys.beginLogin("owner", "fresh", "192.0.2.8");
  const session = await f.service.keys.finishLogin("fresh", f.keys[4].assertion(fresh, 11));
  expect(f.service.keys.status(session.token).credentials).toHaveLength(4);
});

test.each(["expire", "cancel", "session", "target", "key-proof", "password-change"])("password-mode removal rejects %s and keeps the retained key", async (failure) => {
  const f = await passwordMode();
  await f.service.keys.beginRemoval(f.current.token, "remove", f.key.id);
  if (failure === "expire") f.advance(300_001);
  if (failure === "cancel") f.service.keys.cancel("remove");
  const removal = f.service.keys.finishRemoval(failure === "session" ? "foreign" : f.current.token, "remove", failure === "target" ? "foreign-target" : f.key.id, failure === "key-proof" ? {} : password);
  if (failure === "password-change") {
    f.database.getClient().$client.prepare("UPDATE password_credentials SET password_hash = 'changed' WHERE user_id = ?").run(f.current.user.id);
  }
  await expect(removal).rejects.toThrow();
  expect(f.service.keys.status(f.current.token)).toMatchObject({ enabled: false, credentials: [{ id: f.key.id }] });
  await expect(f.service.keys.finishRemoval(f.current.token, "remove", f.key.id, password)).rejects.toThrow();
});

test("deletion cannot target another account's key and removal limits persist across service instances", async () => {
  const f = await passwordMode();
  const foreign = await seedAuthenticatedAccount(f.service, f.database.getClient(), "foreign", password, "192.0.2.5");
  await expect(f.service.keys.beginRemoval(foreign.token, "foreign", f.key.id)).rejects.toThrow();
  for (let n = 0; n < 10; n++) await f.service.keys.beginRemoval(f.current.token, "remove", f.key.id);
  await expect(new AuthenticationService(f.database.getClient(), () => new Date("2026-09-13T19:00:00.000Z")).keys.beginRemoval(f.current.token, "remove", f.key.id)).rejects.toThrow("Too many");
});

test("concurrent final-key removals restore password mode once and revoke pending login", async () => {
  const f = await fixture();
  const { key, session } = await enroll(f.service, f.session.token);
  const a = await f.service.keys.beginRemoval(session.token, "a", key.id);
  const b = await f.service.keys.beginRemoval(session.token, "b", key.id);
  const login = await f.service.keys.beginLogin("owner", "login", "192.0.2.8");
  const results = await Promise.allSettled([
    f.service.keys.finishRemoval(session.token, "a", key.id, key.assertion(a.options!, 2)),
    f.service.keys.finishRemoval(session.token, "b", key.id, key.assertion(b.options!, 3)),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  await expect(f.service.keys.finishLogin("login", key.assertion(login, 4))).rejects.toThrow();
  const passwordLogin = await f.service.login("owner", password, "192.0.2.8");
  if (!passwordLogin.ok) throw new Error("password login failed");
  expect(f.service.keys.status(passwordLogin.session.token)).toEqual({ enabled: false, credentials: [] });
});

test("disabling and re-enabling after deletion cannot restore a removed credential", async () => {
  const f = await fiveKeys();
  const proof = await f.service.keys.beginRemoval(f.current.token, "remove", f.keys[0].id);
  await f.service.keys.finishRemoval(f.current.token, "remove", f.keys[0].id, f.keys[4].assertion(proof.options!, 10));
  const login = await f.service.keys.beginLogin("owner", "login", "192.0.2.8");
  const current = await f.service.keys.finishLogin("login", f.keys[4].assertion(login, 11));
  const disable = await f.service.keys.beginModeChange(current.token, "disable", false);
  await f.service.keys.finishModeChange(current.token, "disable", false, f.keys[4].assertion(disable, 12));
  const passwordLogin = await f.service.login("owner", password, "192.0.2.8");
  if (!passwordLogin.ok) throw new Error("password login failed");
  const enable = await f.service.keys.beginModeChange(passwordLogin.session.token, "enable", true);
  const restored = (await f.service.keys.finishModeChange(passwordLogin.session.token, "enable", true, f.keys[4].assertion(enable, 13)))!;
  expect(f.service.keys.status(restored.token).credentials).toHaveLength(4);
  const staleKey = await f.service.keys.beginLogin("owner", "removed", "192.0.2.8");
  expect(staleKey.allowCredentials?.map((key) => key.id)).not.toContain(f.keys[0].id);
  await expect(f.service.keys.finishLogin("removed", f.keys[0].assertion(staleKey, 14))).rejects.toThrow();
});

test.each(["cancel", "expire", "bad-signature", "wrong-purpose", "enrollment-purpose", "wrong-session", "credential-change", "account-change"])(
  "failed re-enable (%s) preserves password mode and consumes the attempt", async (failure) => {
    const f = await passwordMode();
    const proof = await f.service.keys.beginModeChange(f.current.token, "enable", true);
    const response = f.key.assertion(proof, 3, { badSignature: failure === "bad-signature" });
    if (failure === "cancel") f.service.keys.cancel("enable");
    if (failure === "expire") f.advance(300_001);
    if (failure === "account-change") {
      f.database.getClient().update(users).set({ authenticationVersion: 99 }).where(eq(users.id, f.current.user.id)).run();
    }
    let finishing: Promise<unknown>;
    if (failure === "credential-change") {
      const other = openApplicationDatabase({ databasePath: f.database.getClient().$client.name, migrationsFolder: path.resolve("drizzle") });
      try {
        finishing = f.service.keys.finishModeChange(f.current.token, "enable", true, response);
        other.getClient().$client.prepare("UPDATE webauthn_credentials SET revision = revision + 1 WHERE id = ?").run(f.key.id);
      } finally { other.close(); }
    } else if (failure === "wrong-purpose") {
      finishing = f.service.keys.finishLogin("enable", response);
    } else if (failure === "enrollment-purpose") {
      finishing = f.service.keys.finishEnrollment(f.current.token, "enable", response);
    } else {
      finishing = f.service.keys.finishModeChange(failure === "wrong-session" ? "foreign" : f.current.token, "enable", true, response);
    }
    await expect(finishing).rejects.toThrow();
    expect(f.service.keys.status(f.current.token).enabled).toBe(false);
    await expect(f.service.keys.finishModeChange(f.current.token, "enable", true, response)).rejects.toThrow();
    expect((await f.service.login("owner", password, "192.0.2.3")).ok).toBe(true);
  },
);

test("concurrent re-enable attempts commit once, revoke password sessions and pending registration, and burn replay", async () => {
  const f = await passwordMode();
  const other = await f.service.login("owner", password, "192.0.2.3");
  if (!other.ok) throw new Error("password login failed");
  const a = await f.service.keys.beginModeChange(f.current.token, "a", true);
  const b = await f.service.keys.beginModeChange(other.session.token, "b", true);
  const registration = await f.service.keys.beginEnrollment(other.session.token, "register", "Pending backup");
  const results = await Promise.allSettled([
    f.service.keys.finishModeChange(f.current.token, "a", true, f.key.assertion(a, 3)),
    f.service.keys.finishModeChange(other.session.token, "b", true, f.key.assertion(b, 4)),
  ]);
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(await f.service.authenticate(other.session.token)).toBeUndefined();
  await expect(f.service.keys.finishRegistration(other.session.token, "register", authenticator().registration(registration))).rejects.toThrow();
  await expect(f.service.keys.finishModeChange(f.current.token, "a", true, f.key.assertion(a, 3))).rejects.toThrow();
});

test.each([true, false])("storage failure during mode change to %s rolls back and burns submitted proof", async (enabled) => {
  const f = await passwordMode();
  const key = f.key;
  let current = f.current;
  if (!enabled) {
    const enable = await f.service.keys.beginModeChange(current.token, "enable", true);
    current = (await f.service.keys.finishModeChange(current.token, "enable", true, key.assertion(enable, 3)))!;
  }
  const proof = await f.service.keys.beginModeChange(current.token, "mode", enabled);
  f.database.getClient().$client.exec("CREATE TRIGGER refuse_mode BEFORE UPDATE OF key_login_enabled ON users BEGIN SELECT RAISE(ABORT, 'storage failure'); END");
  await expect(f.service.keys.finishModeChange(current.token, "mode", enabled, key.assertion(proof, 4))).rejects.toThrow();
  f.database.getClient().$client.exec("DROP TRIGGER refuse_mode");
  expect(f.service.keys.status(current.token).enabled).toBe(!enabled);
  await expect(f.service.keys.finishModeChange(current.token, "mode", enabled, key.assertion(proof, 4))).rejects.toThrow();
});

test("mode changes require saved credentials, matching current mode, preview and durable rate limits", async () => {
  const f = await fixture();
  await expect(f.service.keys.beginModeChange(f.session.token, "mode", true)).rejects.toThrow("first key");
  const { session: current } = await enroll(f.service, f.session.token);
  await expect(f.service.keys.beginModeChange(current.token, "mode", true)).rejects.toThrow();
  vi.stubEnv("WEBAUTHN_ENROLLMENT_PREVIEW", "");
  await expect(f.service.keys.beginModeChange(current.token, "mode", false)).rejects.toThrow("preview");
  vi.stubEnv("WEBAUTHN_ENROLLMENT_PREVIEW", "1");
  for (let n = 0; n < 8; n++) await f.service.keys.beginModeChange(current.token, "mode", false);
  await expect(new AuthenticationService(f.database.getClient(), () => new Date("2026-09-13T19:00:00.000Z")).keys.beginModeChange(current.token, "mode", false)).rejects.toThrow("Too many");
});
