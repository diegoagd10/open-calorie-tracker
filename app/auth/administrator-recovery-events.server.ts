import { operationalLog } from "../../server/operational-logging.js";

export function logAdministratorRecovery(
  outcome:
    | "administrator-not-found"
    | "administrator-invariant-violated"
    | "administrator-credential-not-found"
    | "failed"
    | "succeeded",
): void {
  operationalLog(outcome === "succeeded" ? "warn" : "error", "administrator_recovery", {
    outcome,
  });
}
