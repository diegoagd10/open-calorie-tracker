import { eq } from "drizzle-orm";

import type { CredentialBundlePersistence, StoredCredentialBundle } from "../credentials/encrypted-credential-bundles.server";
import type { ApplicationDatabaseClient } from "./database.server";
import { encryptedCredentialBundles } from "./schema.server";

export class DatabaseCredentialBundlePersistence implements CredentialBundlePersistence {
  constructor(private readonly database: ApplicationDatabaseClient) {}

  read(name: string): StoredCredentialBundle | undefined {
    return this.database
      .select()
      .from(encryptedCredentialBundles)
      .where(eq(encryptedCredentialBundles.name, name))
      .get();
  }

  replace(bundle: StoredCredentialBundle): void {
    this.database
      .insert(encryptedCredentialBundles)
      .values(bundle)
      .onConflictDoUpdate({
        target: encryptedCredentialBundles.name,
        set: { envelope: bundle.envelope, updatedAt: bundle.updatedAt },
      })
      .run();
  }

  remove(name: string): boolean {
    return this.database
      .delete(encryptedCredentialBundles)
      .where(eq(encryptedCredentialBundles.name, name))
      .run().changes > 0;
  }
}
