import {
  operationalError,
  operationalLog,
} from "../../server/operational-logging.js";

export type BootstrapRejectionReason =
  | "authenticated-request"
  | "claimed-instance"
  | "invalid-csrf"
  | "invalid-input"
  | "invalid-origin"
  | "rate-limited";

export function logBootstrapRejected(reason: BootstrapRejectionReason): void {
  operationalLog("info", "administrator_bootstrap", {
    outcome: "rejected",
    reason,
  });
}

export function logBootstrapSucceeded(userId: number, username: string): void {
  operationalLog("info", "administrator_bootstrap", {
    outcome: "succeeded",
    userId,
    username,
  });
}

export function logBootstrapFailed(error: unknown): void {
  operationalLog("error", "administrator_bootstrap", {
    error: operationalError(error, false),
    outcome: "failed",
  });
}
