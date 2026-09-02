import { operationalLog } from "../../server/operational-logging.js";

export function logMemberProvisioned(userId: number, username: string): void {
  operationalLog("info", "member_provisioning", {
    outcome: "succeeded",
    userId,
    username,
  });
}

export function logMemberAccessChanged(
  action: "disable" | "reactivate",
  actor: { id: number; username: string },
  targetUsername: string,
  outcome:
    | "already-active"
    | "already-disabled"
    | "confirmation-mismatch"
    | "failed"
    | "not-found"
    | "succeeded",
): void {
  operationalLog(outcome === "failed" ? "error" : "info", "member_access", {
    action,
    actorId: actor.id,
    actorUsername: actor.username,
    outcome,
    targetUsername,
  });
}
