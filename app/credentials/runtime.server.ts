import path from "node:path";
import { z } from "zod";

import { DatabaseCredentialBundlePersistence } from "../database/credential-bundles.server";
import type { ApplicationDatabaseClient } from "../database/database.server";
import { getApplicationDatabase } from "../database/runtime.server";
import { openEncryptedCredentialBundles, type EncryptedCredentialBundles } from "./encrypted-credential-bundles.server";

const environmentSchema = z.object({
  APPLICATION_MASTER_KEY_PATH: z.string().optional(),
  APPLICATION_SECRETS_PATH: z.string().optional(),
});

function configuredPath(value: string | undefined, name: string): string | undefined {
  if (value === undefined) return undefined;
  const candidate = value.trim();
  if (!candidate) throw new Error(`${name} cannot be blank.`);
  return candidate;
}

export function credentialStoragePaths(environment: NodeJS.ProcessEnv = process.env) {
  const parsed = environmentSchema.parse(environment);
  const secretsPath = configuredPath(parsed.APPLICATION_SECRETS_PATH, "APPLICATION_SECRETS_PATH")
    ?? path.resolve("secrets");
  return {
    secretsPath,
    masterKeyPath: configuredPath(parsed.APPLICATION_MASTER_KEY_PATH, "APPLICATION_MASTER_KEY_PATH")
      ?? path.join(secretsPath, "application-master.key"),
  };
}

let current: {
  database: ApplicationDatabaseClient;
  masterKeyPath: string;
  bundles: Promise<EncryptedCredentialBundles>;
} | undefined;

export function initializeCredentialStorage(): Promise<EncryptedCredentialBundles> {
  const database = getApplicationDatabase().getClient();
  const { masterKeyPath } = credentialStoragePaths();
  if (current?.database === database && current.masterKeyPath === masterKeyPath) return current.bundles;
  const bundles = openEncryptedCredentialBundles({
    masterKeyPath,
    persistence: new DatabaseCredentialBundlePersistence(database),
  });
  current = { database, masterKeyPath, bundles };
  void bundles.catch(() => {
    if (current?.bundles === bundles) current = undefined;
  });
  return bundles;
}

export function shutdownCredentialStorage(): void {
  current = undefined;
}
