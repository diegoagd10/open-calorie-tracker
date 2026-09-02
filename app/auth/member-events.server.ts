import { operationalLog } from "../../server/operational-logging.js";

export function logMemberProvisioned(userId: number, username: string): void {
  operationalLog("info", "member_provisioning", {
    outcome: "succeeded",
    userId,
    username,
  });
}
