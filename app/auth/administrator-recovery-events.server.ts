import { operationalLog } from "../../server/operational-logging.js";
import type { AdministratorRecoveryError } from "../database/administrator-recovery.server";

export function logAdministratorRecovery(
  outcome: AdministratorRecoveryError | "failed" | "succeeded",
): void {
  operationalLog(outcome === "succeeded" ? "warn" : "error", "administrator_recovery", {
    outcome,
  });
}

export function logAdministratorKeyRecovery(
  outcome: AdministratorRecoveryError | "failed" | "succeeded",
): void {
  operationalLog(outcome === "succeeded" ? "warn" : "error", "administrator_key_recovery", { outcome });
}
