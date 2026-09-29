import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { expect, test } from "vitest";
import { allowsAnyTool, createMcpServer, toolScopes } from "../app/mcp/server.server";
import type { McpTool } from "../app/mcp/tools.server";
import type { ApiKeyScope } from "../app/api-keys/presets";

const futureWrite = "future:write" as ApiKeyScope;
const futureRead = "future:read" as ApiKeyScope;

/** Tools under different scope sets, so filtering is visible with today's single real scope. */
const tools: McpTool[] = [
  {
    scopes: ["daily-log:read"],
    register: (server, userId) => server.registerTool("whoami", { inputSchema: {} }, () => ({ content: [{ type: "text", text: `user ${userId}` }] })),
  },
  {
    scopes: [futureWrite],
    register: (server) => server.registerTool("write_something", { inputSchema: {} }, () => ({ content: [{ type: "text", text: "written" }] })),
  },
  {
    scopes: [futureRead, futureWrite],
    register: (server) => server.registerTool("read_or_write", { inputSchema: {} }, () => ({ content: [{ type: "text", text: "either" }] })),
  },
];

async function connect(scopes: string[]) {
  const server = createMcpServer({ userId: 7, scopes }, tools);
  const client = new Client({ name: "test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

async function refusalOf(client: Client, name: string) {
  const refused = await client.callTool({ name, arguments: {} }).catch((error: unknown) => error);
  return refused instanceof Error ? refused.message : JSON.stringify(refused);
}

test("tools/list returns only the tools the key's scopes allow", async () => {
  const client = await connect(["daily-log:read"]);
  expect((await client.listTools()).tools.map((tool) => tool.name)).toEqual(["whoami"]);
  const everything = await connect(["daily-log:read", "future:write"]);
  expect((await everything.listTools()).tools.map((tool) => tool.name)).toEqual(["whoami", "write_something", "read_or_write"]);
});

test("tools/call checks the scope again and runs allowed tools as the key's owner", async () => {
  const client = await connect(["daily-log:read"]);
  expect(await client.callTool({ name: "whoami", arguments: {} })).toMatchObject({ content: [{ text: "user 7" }] });
  const refusal = await refusalOf(client, "write_something");
  expect(refusal).toMatch(/disabled/u);
  expect(refusal).not.toContain("written");
});

test.each(["future:read", "future:write"])("a tool with two scopes is listed and callable with %s alone", async (scope) => {
  const client = await connect([scope]);
  expect((await client.listTools()).tools.map((tool) => tool.name)).toContain("read_or_write");
  expect(await client.callTool({ name: "read_or_write", arguments: {} })).toMatchObject({ content: [{ text: "either" }] });
});

test("a tool with two scopes is hidden and refused with neither", async () => {
  const client = await connect(["daily-log:read"]);
  expect((await client.listTools()).tools.map((tool) => tool.name)).not.toContain("read_or_write");
  const refusal = await refusalOf(client, "read_or_write");
  expect(refusal).toMatch(/disabled/u);
  expect(refusal).not.toContain("either");
});

test("a key needs at least one tool's scope to use the MCP at all", () => {
  expect(allowsAnyTool(["daily-log:read"])).toBe(true);
  expect(allowsAnyTool(["future:read"], tools)).toBe(true);
  expect(allowsAnyTool(["other:read"])).toBe(false);
  expect(allowsAnyTool(["other:read"], tools)).toBe(false);
  expect(allowsAnyTool([])).toBe(false);
  expect(toolScopes(tools)).toBe("daily-log:read future:write future:read");
});
