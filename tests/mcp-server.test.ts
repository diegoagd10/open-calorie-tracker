import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { expect, test } from "vitest";
import { allowsAnyTool, createMcpServer, toolScopes } from "../app/mcp/server.server";
import type { McpTool } from "../app/mcp/tools.server";

/** Two tools under different scopes, so filtering is visible with today's single real scope. */
const tools: McpTool[] = [
  {
    scope: "daily-log:read",
    register: (server, userId) => server.registerTool("whoami", { inputSchema: {} }, () => ({ content: [{ type: "text", text: `user ${userId}` }] })),
  },
  {
    scope: "future:write" as McpTool["scope"],
    register: (server) => server.registerTool("write_something", { inputSchema: {} }, () => ({ content: [{ type: "text", text: "written" }] })),
  },
];

async function connect(scopes: string[]) {
  const server = createMcpServer({ userId: 7, scopes }, tools);
  const client = new Client({ name: "test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

test("tools/list returns only the tools the key's scopes allow", async () => {
  const client = await connect(["daily-log:read"]);
  expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(["whoami"]);
  const everything = await connect(["daily-log:read", "future:write"]);
  expect((await everything.listTools()).tools.map((tool) => tool.name)).toEqual(["whoami", "write_something"]);
});

test("tools/call checks the scope again and runs allowed tools as the key's owner", async () => {
  const client = await connect(["daily-log:read"]);
  expect(await client.callTool({ name: "whoami", arguments: {} })).toMatchObject({ content: [{ text: "user 7" }] });
  const refused = await client.callTool({ name: "write_something", arguments: {} }).catch((error: unknown) => error);
  const refusal = refused instanceof Error ? refused.message : JSON.stringify(refused);
  expect(refusal).toMatch(/disabled/u);
  expect(refusal).not.toContain("written");
});

test("a key needs at least one tool's scope to use the MCP at all", () => {
  expect(allowsAnyTool(["daily-log:read"])).toBe(true);
  expect(allowsAnyTool(["other:read"])).toBe(false);
  expect(allowsAnyTool([])).toBe(false);
  expect(toolScopes(tools)).toBe("daily-log:read future:write");
});
