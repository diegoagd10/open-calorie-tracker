import { chmod, mkdir, mkdtemp, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { afterEach, beforeEach, expect, test } from "vitest";

import {
  CredentialBundleUnreadableError,
  openEncryptedCredentialBundles,
} from "../app/credentials/encrypted-credential-bundles.server";
import { DatabaseCredentialBundlePersistence } from "../app/database/credential-bundles.server";
import { openApplicationDatabase, type ApplicationDatabase } from "../app/database/database.server";
import { credentialStoragePaths } from "../app/credentials/runtime.server";

let directory: string;
let database: ApplicationDatabase;
let masterKeyPath: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "credential-bundles-"));
  database = openApplicationDatabase({
    databasePath: path.join(directory, "application.sqlite"),
    migrationsFolder: path.resolve("drizzle"),
  });
  masterKeyPath = path.join(directory, "secrets", "application-master.key");
});

afterEach(async () => {
  database.close();
  await chmod(path.dirname(masterKeyPath), 0o700).catch(() => undefined);
  await rm(directory, { force: true, recursive: true });
});

async function bundles(keyPath = masterKeyPath) {
  return await openEncryptedCredentialBundles({
    masterKeyPath: keyPath,
    persistence: new DatabaseCredentialBundlePersistence(database.getClient()),
  });
}

test("generic secret paths default outside application data and allow an explicit master-key override", () => {
  expect(credentialStoragePaths({ DATABASE_PATH: "/private/data/application.sqlite" })).toEqual({
    secretsPath: path.resolve("secrets"),
    masterKeyPath: path.resolve("secrets", "application-master.key"),
  });
  expect(credentialStoragePaths({ APPLICATION_SECRETS_PATH: "/mnt/secrets" })).toEqual({
    secretsPath: "/mnt/secrets",
    masterKeyPath: "/mnt/secrets/application-master.key",
  });
  expect(credentialStoragePaths({
    APPLICATION_SECRETS_PATH: "/mnt/secrets",
    APPLICATION_MASTER_KEY_PATH: "/run/keys/custom-master.key",
  })).toEqual({
    secretsPath: "/mnt/secrets",
    masterKeyPath: "/run/keys/custom-master.key",
  });
  expect(() => credentialStoragePaths({ APPLICATION_SECRETS_PATH: " " })).toThrow(
    "APPLICATION_SECRETS_PATH cannot be blank.",
  );
  expect(() => credentialStoragePaths({ APPLICATION_MASTER_KEY_PATH: " " })).toThrow(
    "APPLICATION_MASTER_KEY_PATH cannot be blank.",
  );
});

test("first use creates a private 32-byte master key and round-trips an opaque bundle", async () => {
  const store = await bundles();
  const secret = Buffer.from('{"primary":"primary-private","secondary":"secondary-private"}');

  expect((await stat(path.dirname(masterKeyPath))).mode & 0o777).toBe(0o700);
  expect((await stat(masterKeyPath)).mode & 0o777).toBe(0o600);
  expect(await readFile(masterKeyPath)).toHaveLength(32);
  expect(await store.status("sample-integration")).toEqual({ state: "unconfigured" });

  const configured = await store.replace("sample-integration", secret);
  expect(configured).toEqual({
    state: "configured",
    configuredAt: expect.any(String) as unknown,
    updatedAt: expect.any(String) as unknown,
  });
  expect(await store.read("sample-integration")).toEqual(secret);
  expect(await store.status("sample-integration")).toEqual(configured);
  expect(JSON.stringify(configured)).not.toContain("private");

  const row = database.getClient().get<{ envelope: string }>(sql`
    SELECT envelope FROM encrypted_credential_bundles WHERE name = 'sample-integration'
  `);
  expect(row.envelope).not.toContain("primary-private");
  expect(row.envelope).not.toContain("secondary-private");
});

test("existing master keys cannot grant access to group or other users", async () => {
  await bundles();
  await chmod(masterKeyPath, 0o644);
  await expect(bundles()).rejects.toThrow(
    "Application master key permissions must exclude group and other users.",
  );
  await chmod(masterKeyPath, 0o600);
});

test("the master key cannot live in a directory accessible to group or other users", async () => {
  const broadSecretsPath = path.join(directory, "broad-secrets");
  await mkdir(broadSecretsPath, { mode: 0o755 });
  await expect(bundles(path.join(broadSecretsPath, "application-master.key"))).rejects.toThrow(
    "Application secrets directory permissions must exclude group and other users.",
  );
  await chmod(broadSecretsPath, 0o700);
});

test("existing master keys must be regular files with exactly 32 bytes", async () => {
  const shortKeyPath = path.join(directory, "short-key");
  await writeFile(shortKeyPath, Buffer.alloc(31), { mode: 0o600 });
  await expect(bundles(shortKeyPath)).rejects.toThrow(
    "Application master key must contain exactly 32 bytes.",
  );
  const privateParent = path.join(directory, "private-parent");
  const directoryKeyPath = path.join(privateParent, "key-directory");
  await mkdir(directoryKeyPath, { recursive: true, mode: 0o700 });
  await expect(bundles(directoryKeyPath)).rejects.toThrow(
    "Application master key must be a regular file.",
  );
});

test.each([
  ["invalid characters", (envelope: Record<string, string | number>) => { envelope.nonce = "!"; }],
  ["non-canonical base64url", (envelope: Record<string, string | number>) => { envelope.nonce = "AB"; }],
  ["wrong nonce length", (envelope: Record<string, string | number>) => { envelope.nonce = Buffer.alloc(11).toString("base64url"); }],
  ["wrong tag length", (envelope: Record<string, string | number>) => { envelope.tag = Buffer.alloc(15).toString("base64url"); }],
] as const)("rejects %s in an otherwise structured envelope", async (_name, mutate) => {
  const store = await bundles();
  await store.replace("sample-integration", Buffer.from("credential-pair"));
  const row = database.getClient().get<{ envelope: string }>(sql`
    SELECT envelope FROM encrypted_credential_bundles WHERE name = 'sample-integration'
  `);
  const envelope = JSON.parse(row.envelope) as Record<string, string | number>;
  mutate(envelope);
  database.getClient().run(sql`
    UPDATE encrypted_credential_bundles SET envelope = ${JSON.stringify(envelope)}
    WHERE name = 'sample-integration'
  `);
  await expect(store.read("sample-integration")).rejects.toThrow("Credential bundle is unreadable.");
  expect(await store.status("sample-integration")).toMatchObject({ state: "unreadable" });
});

test("replacement uses a fresh nonce, removal changes future reads, and captured plaintext remains usable", async () => {
  const store = await bundles();
  await store.replace("sample-integration", Buffer.from("first-private-pair"));
  const captured = await store.read("sample-integration");
  const first = database.getClient().get<{ envelope: string }>(sql`
    SELECT envelope FROM encrypted_credential_bundles WHERE name = 'sample-integration'
  `).envelope;

  await store.replace("sample-integration", Buffer.from("second-private-pair"));
  const second = database.getClient().get<{ envelope: string }>(sql`
    SELECT envelope FROM encrypted_credential_bundles WHERE name = 'sample-integration'
  `).envelope;
  expect(second).not.toBe(first);
  expect((JSON.parse(second) as { nonce: string }).nonce).not.toBe(
    (JSON.parse(first) as { nonce: string }).nonce,
  );
  expect(await store.read("sample-integration")).toEqual(Buffer.from("second-private-pair"));

  expect(await store.remove("sample-integration")).toBe(true);
  expect(await store.read("sample-integration")).toBeUndefined();
  expect(await store.status("sample-integration")).toEqual({ state: "unconfigured" });
  expect(captured).toEqual(Buffer.from("first-private-pair"));
  expect(await store.remove("sample-integration")).toBe(false);
});

test("tampering, the wrong key, and purpose substitution are reported without exposing plaintext", async () => {
  const store = await bundles();
  await store.replace("sample-integration", Buffer.from("never reveal this credential"));
  const original = database.getClient().get<{ envelope: string }>(sql`
    SELECT envelope FROM encrypted_credential_bundles WHERE name = 'sample-integration'
  `).envelope;
  const tampered = JSON.parse(original) as { ciphertext: string };
  tampered.ciphertext = `${tampered.ciphertext.startsWith("A") ? "B" : "A"}${tampered.ciphertext.slice(1)}`;

  database.getClient().run(sql`
    UPDATE encrypted_credential_bundles SET envelope = ${JSON.stringify(tampered)}
    WHERE name = 'sample-integration'
  `);
  await expect(store.read("sample-integration")).rejects.toEqual(
    new CredentialBundleUnreadableError(),
  );
  expect(await store.status("sample-integration")).toEqual({
    state: "unreadable",
    configuredAt: expect.any(String) as unknown,
    updatedAt: expect.any(String) as unknown,
  });

  database.getClient().run(sql`
    UPDATE encrypted_credential_bundles SET envelope = ${original}
    WHERE name = 'sample-integration'
  `);
  const otherKey = path.join(directory, "other-secrets", "application-master.key");
  const wrongKeyStore = await bundles(otherKey);
  await expect(wrongKeyStore.read("sample-integration")).rejects.toThrow(
    "Credential bundle is unreadable.",
  );

  database.getClient().run(sql`
    INSERT INTO encrypted_credential_bundles (name, envelope, configured_at, updated_at)
    SELECT 'another-purpose', envelope, configured_at, updated_at
    FROM encrypted_credential_bundles WHERE name = 'sample-integration'
  `);
  await expect(store.read("another-purpose")).rejects.toThrow(
    "Credential bundle is unreadable.",
  );
});

test("a lost master key makes old ciphertext unreadable but permits a validated replacement", async () => {
  const originalStore = await bundles();
  await originalStore.replace("sample-integration", Buffer.from("old-pair"));
  const captured = await originalStore.read("sample-integration");
  await unlink(masterKeyPath);

  const recoveredStore = await bundles();
  expect(await recoveredStore.status("sample-integration")).toMatchObject({ state: "unreadable" });
  await expect(recoveredStore.read("sample-integration")).rejects.toThrow(
    "Credential bundle is unreadable.",
  );
  await recoveredStore.replace("sample-integration", Buffer.from("new-pair"));

  expect(await recoveredStore.read("sample-integration")).toEqual(Buffer.from("new-pair"));
  expect(captured).toEqual(Buffer.from("old-pair"));
});

test("a persistence failure preserves the previous encrypted bundle", async () => {
  const store = await bundles();
  await store.replace("sample-integration", Buffer.from("working-pair"));
  database.getClient().run(sql.raw(`
    CREATE TRIGGER reject_credential_update
    BEFORE UPDATE ON encrypted_credential_bundles
    BEGIN SELECT RAISE(ABORT, 'simulated persistence failure'); END
  `));

  await expect(
    store.replace("sample-integration", Buffer.from("replacement-pair")),
  ).rejects.toThrow("simulated persistence failure");
  database.getClient().run(sql`DROP TRIGGER reject_credential_update`);
  expect(await store.read("sample-integration")).toEqual(Buffer.from("working-pair"));
});
