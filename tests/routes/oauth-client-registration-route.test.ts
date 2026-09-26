import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { RouterContextProvider } from "react-router";
import { afterAll, beforeAll, expect, test, vi } from "vitest";
import { serializeSessionCookie } from "../../app/auth/http.server";
import { getAuthenticationService } from "../../app/auth/runtime.server";
import { getApplicationDatabase, initializeApplicationDatabase, shutdownApplicationDatabase } from "../../app/database/runtime.server";
import { action, loader } from "../../app/routes/settings.oauth-clients";
import { loader as homeLoader } from "../../app/routes/home";
import { seedAuthenticatedAccount } from "../support/authentication";

const origin = "http://localhost:3000";
let directory: string;
let ownerCookie: string;
let ownerCsrf: string;
let otherCookie: string;
let otherCsrf: string;

function args(request: Request) {
  return { request, params: {}, context: new RouterContextProvider(), pattern: "/settings/oauth-clients", url: new URL(request.url) };
}
function get(cookie: string) {
  return args(new Request(`${origin}/settings/oauth-clients`, { headers: { Cookie: cookie } }));
}
function post(fields: Record<string, string>, cookie = ownerCookie, csrfToken = ownerCsrf) {
  return args(new Request(`${origin}/settings/oauth-clients`, {
    method: "POST",
    headers: { Cookie: cookie, Origin: origin },
    body: new URLSearchParams({ csrfToken, ...fields }),
  }));
}

beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "oauth-registration-route-"));
  vi.stubEnv("APPLICATION_URL", origin);
  vi.stubEnv("DATABASE_PATH", path.join(directory, "application.sqlite"));
  initializeApplicationDatabase();
  const auth = getAuthenticationService();
  const owner = await auth.register("oauth.owner", "correct horse battery staple", "203.0.113.180");
  if (!owner.ok) throw new Error("Could not register owner");
  ownerCookie = serializeSessionCookie(owner.session).split(";", 1)[0];
  ownerCsrf = owner.session.csrfToken;
  const other = await seedAuthenticatedAccount(auth, getApplicationDatabase().getClient(), "oauth.other", "correct horse battery staple", "203.0.113.181");
  otherCookie = serializeSessionCookie(other).split(";", 1)[0];
  otherCsrf = other.csrfToken;
});
afterAll(async () => {
  shutdownApplicationDatabase();
  vi.unstubAllEnvs();
  await rm(directory, { recursive: true, force: true });
});

test("a signed-in account registers and reviews a public client without a secret or grant", async () => {
  const response = await action(post({
    intent: "register",
    name: "My terminal",
    redirectUris: "http://127.0.0.1:4567/callback\nhttps://client.example/callback",
  }));
  expect(response.init?.status).toBe(201);
  expect(response.data).toMatchObject({ client: {
    id: expect.any(String) as unknown,
    name: "My terminal",
    type: "public",
    redirectUris: ["http://127.0.0.1:4567/callback", "https://client.example/callback"],
  } });
  expect(response.data.client).not.toHaveProperty("secret");
  expect(response.data.client).not.toHaveProperty("grant");
  expect(response.data.client).not.toHaveProperty("accessToken");
  expect((await loader(get(ownerCookie))).clients).toContainEqual(response.data.client);
  expect((await loader(get(otherCookie))).clients).toEqual([]);
  const bearerOnly = await homeLoader(args(new Request(`${origin}/`, {
    headers: { Authorization: `Bearer ${response.data.client?.id ?? ""}` },
  })));
  expect(bearerOnly).toBeInstanceOf(Response);
  expect((bearerOnly as Response).status).toBe(302);
  expect((bearerOnly as Response).headers.get("Location")).toBe("/login");
});

test("invalid names and redirect URIs do not register a client", async () => {
  const before = (await loader(get(ownerCookie))).clients.length;
  for (const fields of [
    { name: "  ", redirectUris: "https://client.example/callback" },
    { name: "Bad callback", redirectUris: "javascript:alert(1)" },
    { name: "Bad callback", redirectUris: "http://client.example/callback" },
    { name: "Bad callback", redirectUris: "https://client.example/callback#fragment" },
    { name: "Bad callback", redirectUris: "https://user:password@client.example/callback" },
    { name: "Bad callback", redirectUris: "https://*.example/callback" },
    { name: "Bad callback", redirectUris: "https://client.example/*" },
    { name: "Bad callback", redirectUris: "http://localhost.evil/callback" },
    { name: "Bad callback", redirectUris: "https://client.example/callback\nhttps://client.example/callback" },
  ]) {
    const response = await action(post({ intent: "register", ...fields }));
    expect(response.init?.status).toBe(400);
    expect(response.data.errors).toBeDefined();
  }
  expect((await loader(get(ownerCookie))).clients).toHaveLength(before);
});

test("anonymous and cross-site requests cannot register or review clients", async () => {
  await expect(loader(get(""))).rejects.toMatchObject({ status: 302 });
  await expect(action(post({ intent: "register", name: "Anonymous", redirectUris: "https://client.example/callback" }, "")))
    .rejects.toMatchObject({ status: 302 });
  await expect(action(post({ intent: "register", name: "No CSRF", redirectUris: "https://client.example/callback" }, ownerCookie, "invalid")))
    .rejects.toMatchObject({ status: 403 });
  const crossSite = args(new Request(`${origin}/settings/oauth-clients`, {
    method: "POST", headers: { Cookie: ownerCookie, Origin: "https://attacker.example" },
    body: new URLSearchParams({ intent: "register", csrfToken: ownerCsrf, name: "Cross-site", redirectUris: "https://client.example/callback" }),
  }));
  await expect(action(crossSite)).rejects.toMatchObject({ status: 403 });
});

test("client ownership comes from the session and another account cannot change settings", async () => {
  const result = await action(post({
    intent: "register", ownerId: "99999", type: "confidential",
    name: "Owned by member", redirectUris: "https://member.example/callback",
  }, otherCookie, otherCsrf));
  expect(result.init?.status).toBe(201);
  expect(result.data.client?.type).toBe("public");
  expect((await loader(get(ownerCookie))).clients).not.toContainEqual(result.data.client);
  const change = await action(post({
    intent: "update", clientId: result.data.client?.id ?? "", name: "Hijacked",
    redirectUris: "https://attacker.example/callback",
  }));
  expect(change.init?.status).toBe(400);
  expect((await loader(get(otherCookie))).clients).toContainEqual(result.data.client);
});
