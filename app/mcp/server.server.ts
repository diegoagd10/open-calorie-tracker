import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { holdsAnyScope } from "../api-keys/presets";
import { MCP_TOOLS, type McpTool } from "./tools.server";

/** The account and scopes of an authenticated API key. */
export type McpCaller = { userId: number; scopes: readonly string[] };

const MAX_REQUEST_BODY_BYTES = 64 * 1024;

/** Whether `scopes` allow at least one tool, so the caller has anything to use. */
export function allowsAnyTool(scopes: readonly string[], tools: readonly McpTool[] = MCP_TOOLS): boolean {
  return tools.some((tool) => holdsAnyScope(scopes, tool.scopes));
}

/** The scopes that grant tools, space-separated as a Bearer challenge's `scope`. */
export function toolScopes(tools: readonly McpTool[] = MCP_TOOLS): string {
  return [...new Set(tools.flatMap((tool) => tool.scopes))].join(" ");
}

/**
 * An MCP server for one caller. Tools outside the caller's scopes are disabled,
 * so `tools/list` omits them and `tools/call` refuses them.
 */
export function createMcpServer(caller: McpCaller, tools: readonly McpTool[] = MCP_TOOLS): McpServer {
  const server = new McpServer({ name: "open-calory-tracker", version: "1.0.0" });
  for (const tool of tools) {
    const registered = tool.register(server, caller.userId);
    if (!holdsAnyScope(caller.scopes, tool.scopes)) registered.disable();
  }
  return server;
}

/** Answers one MCP POST statelessly: a fresh server and transport, JSON responses, no sessions. */
export async function handleMcpRequest(request: Request, caller: McpCaller): Promise<Response> {
  const server = createMcpServer(caller);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
    maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
  });
  try {
    await server.connect(transport);
    return await transport.handleRequest(request);
  } finally {
    await server.close();
  }
}
