import { randomBytes } from "node:crypto";

import type { ApplicationDatabaseClient } from "../database/database.server";
import {
  replaceSoleAdministratorCredential,
  type AdministratorRecoveryError,
} from "../database/administrator-recovery.server";
import { logAdministratorRecovery } from "./administrator-recovery-events.server";
import { hashPassword } from "./password.server";

export type AdministratorRecoveryResult =
  | { error: AdministratorRecoveryError; ok: false }
  | { ok: true; temporaryPassword: string };

function generateTemporaryPassword(): string {
  return randomBytes(24).toString("base64url");
}

export class AdministratorRecoveryService {
  readonly #database: ApplicationDatabaseClient;
  readonly #generateTemporaryPassword: () => string;
  readonly #now: () => Date;

  constructor(
    database: ApplicationDatabaseClient,
    now: () => Date = () => new Date(),
    temporaryPasswordGenerator: () => string = generateTemporaryPassword,
  ) {
    this.#database = database;
    this.#now = now;
    this.#generateTemporaryPassword = temporaryPasswordGenerator;
  }

  async recover(): Promise<AdministratorRecoveryResult> {
    const temporaryPassword = this.#generateTemporaryPassword();
    try {
      const passwordHash = await hashPassword(temporaryPassword);
      const result = replaceSoleAdministratorCredential(this.#database, {
        passwordHash,
        updatedAt: this.#now().toISOString(),
      });
      if (!result.ok) {
        logAdministratorRecovery(result.error);
        return result;
      }

      logAdministratorRecovery("succeeded");
      return { ok: true, temporaryPassword };
    } catch (error) {
      logAdministratorRecovery("failed");
      throw error;
    }
  }
}
