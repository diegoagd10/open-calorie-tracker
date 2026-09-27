import type { Server } from "node:http";
import express from "express";
import type { ServerBuild } from "react-router";
import { afterEach, expect, test, vi } from "vitest";

import { serializeClearedSessionCookie, requireValidOrigin } from "../app/auth/http.server";
import { effectiveRequestPolicy, type RequestEntry } from "../app/runtime.server";
import { entryPolicy } from "../server/entry-policy";
import { routerHandler } from "../server/router";
import { requestHttp } from "./support/http";

const servers: Server[] = [];
const publicOrigin = "https://calories.example.test";
const lanOrigin = "http://192.168.4.21:3002";

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  })));
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function listener(entry: RequestEntry, resourceResponse?: Response) {
  vi.stubEnv("APPLICATION_URL", publicOrigin);
  vi.stubEnv("LAN_URL", lanOrigin);
  const build: ServerBuild = {
    entry: { module: { default: (request, status, headers, context) => resourceResponse ?? Response.json({
      url: request.url, policy: effectiveRequestPolicy(), peer: request.headers.get("X-Fixture-Peer"), clientIp: request.headers.get("X-Open-Calory-Client-IP"),
      actionData: context.staticHandlerContext.actionData,
    }, { status, headers }) } },
    routes: { root: { id: "root", path: "*", module: {
      default: () => null,
      loader: () => null,
      action: async ({ request }) => {
        requireValidOrigin(request);
        return { value: (await request.formData()).get("value") };
      },
      headers: () => ({ "Set-Cookie": serializeClearedSessionCookie() }),
    } } },
    assets: { entry: { imports: [], module: "" }, routes: {}, url: "", version: "test" },
    publicPath: "/", assetsBuildDirectory: "", future: {}, ssr: true,
    isSpaMode: false, prerender: [], routeDiscovery: { mode: "initial", manifestPath: "/__manifest" },
  };
  const app = express();
  app.use((request, _response, next) => {
    request.headers["x-fixture-peer"] = request.socket.remoteAddress;
    next();
  });
  app.use(entryPolicy(entry));
  app.use(routerHandler(async () => build));
  const server = app.listen(0, "127.0.0.1");
  servers.push(server);
  await new Promise<void>(resolve => server.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Listener missing address");
  return `http://127.0.0.1:${address.port}`;
}

test("identical peers use listener-owned origins, client IPs and cookie policies", async () => {
  const tunnel = await listener("tunnel");
  const lan = await listener("lan");
  const forged = { "CF-Connecting-IP": "2001:db8::12", "X-Forwarded-For": "203.0.113.99", "X-Forwarded-Host": "attacker.invalid", "X-Forwarded-Proto": "https", "X-Open-Calory-Client-IP": "attacker-choice" };
  const publicResponse = await requestHttp(`${tunnel}/form?query=kept`, { headers: { ...forged, Host: "calories.example.test" } });
  const lanResponse = await requestHttp(`${lan}/form?query=kept`, { headers: { ...forged, Host: "192.168.4.21:3002" } });
  const publicData = await publicResponse.json() as { peer: string };
  const lanData = await lanResponse.json() as { peer: string };
  expect(publicData).toMatchObject({ url: `${publicOrigin}/form?query=kept`, policy: { entry: "tunnel", origin: publicOrigin }, clientIp: "2001:db8::12" });
  expect(lanData).toMatchObject({ url: `${lanOrigin}/form?query=kept`, policy: { entry: "lan", origin: lanOrigin }, clientIp: "127.0.0.1" });
  expect(publicData.peer).toBe(lanData.peer);
  expect(publicResponse.headers.getSetCookie()[0]).toContain("__Host-calorie_session=");
  expect(publicResponse.headers.getSetCookie()[0]).toContain("Secure");
  expect(lanResponse.headers.getSetCookie()[0]).toContain("calorie_lan_session=");
  expect(lanResponse.headers.getSetCookie()[0]).not.toContain("Secure");
});

test.each(["tunnel", "lan"] as const)("%s keeps framework origin rejection and allows same-entry forms", async entry => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const url = await listener(entry);
  const origin = entry === "tunnel" ? publicOrigin : lanOrigin;
  const headers = { Host: new URL(origin).host, "CF-Connecting-IP": "203.0.113.1", "Content-Type": "application/x-www-form-urlencoded" };
  const accepted = await requestHttp(`${url}/form?query=kept`, { method: "POST", headers: { ...headers, Origin: origin }, body: "value=works" });
  expect(accepted.status).toBe(200);
  expect(await accepted.json()).toMatchObject({ url: `${origin}/form?query=kept`, actionData: { root: { value: "works" } } });
  for (const Origin of ["https://attacker.invalid", "null", `${origin}.attacker.invalid`, entry === "tunnel" ? lanOrigin : publicOrigin]) {
    const rejected = await requestHttp(`${url}/form`, { method: "POST", headers: { ...headers, Origin }, body: "value=forbidden" });
    expect(rejected.status).toBe(400);
    expect(await rejected.text()).toBe("Bad Request");
  }
});

test("Tunnel requires one visitor IP and only GET/HEAD health is exempt", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const url = await listener("tunnel");
  const duplicate = await requestHttp(`${url}/login`, { headers: { Host: "calories.example.test", "CF-Connecting-IP": ["203.0.113.1", "203.0.113.2"] } });
  expect(duplicate.status).toBe(503);
  const health = await requestHttp(`${url}/health/live`);
  expect(health.status).toBe(200);
  const mutation = await requestHttp(`${url}/health/live`, { method: "POST", headers: { Host: "calories.example.test" } });
  expect(mutation.status).toBe(503);
  const unknownHost = await requestHttp(`${url}/login`, { headers: { Host: "calories.example.test.attacker.invalid", "CF-Connecting-IP": "203.0.113.1" } });
  expect(unknownHost.status).toBe(421);
});

test("the adapter preserves streaming responses and separate Set-Cookie fields", async () => {
  const headers = new Headers({ "Content-Type": "text/event-stream", "X-Fixture": "preserved" });
  headers.append("Set-Cookie", "first=one; HttpOnly; Path=/");
  headers.append("Set-Cookie", "second=two; HttpOnly; Path=/");
  const url = await listener("lan", new Response("data: ready\n\n", { headers }));
  const response = await requestHttp(`${url}/stream`, { headers: { Host: "192.168.4.21:3002" } });
  expect(response.headers.get("x-fixture")).toBe("preserved");
  expect(response.headers.getSetCookie()).toEqual(["first=one; HttpOnly; Path=/", "second=two; HttpOnly; Path=/"]);
  expect(await response.text()).toBe("data: ready\n\n");
});

test("the adapter sends no-content responses without manufacturing a body or cookies", async () => {
  const url = await listener("lan", new Response(null, { status: 204 }));
  const response = await requestHttp(`${url}/empty`, { headers: { Host: "192.168.4.21:3002" } });
  expect(response.status).toBe(204);
  expect(response.headers.getSetCookie()).toEqual([]);
  expect(await response.text()).toBe("");
});

test.each(["light", "dark"] as const)("connection verification errors follow the saved %s preference", async theme => {
  const url = await listener("tunnel");
  const response = await requestHttp(`${url}/`, { headers: { Host: "calories.example.test", Cookie: `appearance=${theme}` } });
  expect(response.status).toBe(503);
  const html = await response.text();
  expect(html).toContain(`color-scheme:${theme}`);
  expect(html).toContain(theme === "light" ? "background:#f5f1e8;color:#1d1a15" : "background:#12110e;color:#f3efe7");
});
