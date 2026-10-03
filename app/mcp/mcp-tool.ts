import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import type { ApiKeyScope } from "../api-keys/presets";

/** An MCP tool and the API key scope a caller needs to see and call it. */
export type McpTool = {
  scope: ApiKeyScope;
  register(server: McpServer, userId: number): ReturnType<McpServer["registerTool"]>;
};

/** A tool failure the agent can read and act on, instead of a protocol error. */
export function toolError(text: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text }] };
}
