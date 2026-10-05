import { eq } from "drizzle-orm";

import type { ApplicationDatabaseClient } from "../database/database.server";
import { applicationMetadata } from "../database/schema.server";

const CONTACT_KEY = "off:contact";

/** The instance-wide Open Food Facts contact email, stored in application metadata. */
export class BarcodeRepository {
  readonly #database: ApplicationDatabaseClient;

  constructor(database: ApplicationDatabaseClient) {
    this.#database = database;
  }

  readContact(): string | undefined {
    return this.#database
      .select({ value: applicationMetadata.value })
      .from(applicationMetadata)
      .where(eq(applicationMetadata.key, CONTACT_KEY))
      .get()?.value;
  }

  saveContact(email: string, at: Date): void {
    const row = { key: CONTACT_KEY, value: email, updatedAt: at.toISOString() };
    this.#database
      .insert(applicationMetadata)
      .values(row)
      .onConflictDoUpdate({ target: applicationMetadata.key, set: row })
      .run();
  }

  deleteContact(): void {
    this.#database.delete(applicationMetadata).where(eq(applicationMetadata.key, CONTACT_KEY)).run();
  }
}
