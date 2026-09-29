import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

/** Why a tool cannot act for an account that has not finished setup, shared by every tool. */
export const MISSING_SETUP_MESSAGE = "This account has not finished setup, so it has no Food Log yet. Finish setup in Open Calorie Tracker first.";

/** A tool failure the agent can read and act on, instead of a protocol error. */
export function toolError(text: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text }] };
}
