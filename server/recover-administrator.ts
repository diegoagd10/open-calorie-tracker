import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  AdministratorRecoveryService,
} from "../app/auth/administrator-recovery.server";
import { logAdministratorRecovery } from "../app/auth/administrator-recovery-events.server";
import type { ApplicationDatabase } from "../app/database/database.server";
import { initializeApplicationDatabase } from "../app/database/runtime.server";

export type AdministratorRecoveryCommandOptions = {
  applicationDatabase?: ApplicationDatabase;
  temporaryPasswordGenerator?: () => string;
  writeStandardOutput?: (value: string) => void;
};

export async function runAdministratorRecoveryCommand(
  options: AdministratorRecoveryCommandOptions = {},
): Promise<number> {
  let applicationDatabase: ApplicationDatabase | undefined;
  try {
    applicationDatabase =
      options.applicationDatabase ?? initializeApplicationDatabase();
    const recovery = new AdministratorRecoveryService(
      applicationDatabase.getClient(),
      undefined,
      options.temporaryPasswordGenerator,
    );
    const result = await recovery.recover();
    if (!result.ok) return 1;

    const writeStandardOutput =
      options.writeStandardOutput ?? ((value: string) => process.stdout.write(value));
    writeStandardOutput(`${result.temporaryPassword}\n`);
    return 0;
  } catch {
    if (!applicationDatabase) {
      logAdministratorRecovery("failed");
    }
    return 1;
  } finally {
    applicationDatabase?.close();
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath &&
  pathToFileURL(path.resolve(invokedPath)).href === import.meta.url
) {
  process.exitCode = await runAdministratorRecoveryCommand();
}
