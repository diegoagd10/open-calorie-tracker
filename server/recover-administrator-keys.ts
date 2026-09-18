import path from "node:path";
import { pathToFileURL } from "node:url";

import { AdministratorRecoveryService } from "../app/auth/administrator-recovery.server";
import { logAdministratorKeyRecovery } from "../app/auth/administrator-recovery-events.server";
import { initializeApplicationDatabase, shutdownApplicationDatabase } from "../app/database/runtime.server";

export type AdministratorKeyRecoveryCommandOptions = {
  writeStandardOutput?: (value: string) => void;
};

export function runAdministratorKeyRecoveryCommand(
  options: AdministratorKeyRecoveryCommandOptions = {},
): number {
  let initialized = false;
  try {
    const database = initializeApplicationDatabase();
    initialized = true;
    const result = new AdministratorRecoveryService(database.getClient()).disableKeyLogin();
    if (!result.ok) return 1;
    const write = options.writeStandardOutput ?? ((value: string) => process.stdout.write(value));
    write("Administrator key login disabled; sessions and pending proofs revoked.\n");
    return 0;
  } catch {
    if (!initialized) logAdministratorKeyRecovery("failed");
    return 1;
  } finally {
    shutdownApplicationDatabase();
  }
}

const invokedPath = process.argv[1];
if (invokedPath && pathToFileURL(path.resolve(invokedPath)).href === import.meta.url) {
  process.exitCode = runAdministratorKeyRecoveryCommand();
}
