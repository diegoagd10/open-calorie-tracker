import { mkdtemp, readFile, rm, stat, writeFile, mkdir } from "node:fs/promises";
import { get } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import { PiConnectionService } from "../app/photo-analysis/pi-connection.server";

let directory: string;
let service: PiConnectionService;

function visitCallback(url: string) {
  return new Promise<void>((resolve, reject) => {
    const request = get(url, response => {
      response.resume();
      response.on("end", () => {
        if (response.statusCode === 200) resolve();
        else reject(new Error(`Callback returned ${response.statusCode}`));
      });
    });
    request.on("error", reject);
  });
}

afterEach(async () => {
  service?.shutdown();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (directory) await rm(directory, { recursive: true, force: true });
});

test("administrator connects in a browser and the saved connection survives a new service", async () => {
  directory = await mkdtemp(path.join(tmpdir(), "pi-connection-"));
  const authPath = path.join(directory, "pi/auth.json");
  const access = `test.${Buffer.from(JSON.stringify({
    "https://api.openai.com/auth": { chatgpt_account_id: "synthetic-account" },
  })).toString("base64")}.test`;
  const network = vi.fn(async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith("/oauth/token")) return Response.json({
      access_token: access, refresh_token: "synthetic-refresh-secret", expires_in: 3600,
    });
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", network);
  service = new PiConnectionService(authPath, "openai-codex");
  expect(await service.read("admin-session")).toMatchObject({ connected: false, supported: true });
  const { ModelRuntime } = await import("@earendil-works/pi-coding-agent");
  const photoRuntime = await ModelRuntime.create({ authPath, modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  expect(await photoRuntime.getAuth("openai-codex")).toBeUndefined();
  service.start("admin-session");
  await vi.waitFor(async () => {
    const connection = await service.read("admin-session");
    expect(connection).toMatchObject({ connected: false, attempt: { state: "waiting" } });
    expect(connection.attempt?.authorizationUrl).toContain("https://auth.openai.com/oauth/authorize?");
  });
  const pending = (await service.read("admin-session")).attempt!;
  const state = new URL(pending.authorizationUrl!).searchParams.get("state");
  await visitCallback(`http://localhost:1455/auth/callback?code=private-code&state=${state}`);
  await vi.waitFor(async () => {
    expect(await service.read("admin-session")).toMatchObject({ connected: true, attempt: { state: "connected" } });
  }, { timeout: 5000 });
  expect((await photoRuntime.getAuth("openai-codex"))?.auth.apiKey).toBe(access);
  const publicState = JSON.stringify(await service.read("admin-session"));
  expect(publicState).not.toContain("synthetic-refresh-secret");
  expect(publicState).not.toContain("private-code");
  expect(JSON.parse(await readFile(authPath, "utf8"))).toMatchObject({
    "openai-codex": { type: "oauth", refresh: "synthetic-refresh-secret" },
  });
  expect((await stat(authPath)).mode & 0o777).toBe(0o600);
  const restarted = new PiConnectionService(authPath, "openai-codex");
  expect(await restarted.read("new-session")).toMatchObject({ connected: true });
  await restarted.disconnect("new-session");
  expect(await service.read("admin-session")).toMatchObject({ connected: false });
  expect(await photoRuntime.getAuth("openai-codex")).toBeUndefined();
  restarted.shutdown();
});

async function pendingConnection() {
  directory = await mkdtemp(path.join(tmpdir(), "pi-pending-"));
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 500 })));
  service = new PiConnectionService(path.join(directory, "auth.json"), "openai-codex");
  service.start("owner-session");
  await vi.waitFor(async () => {
    expect(await service.read("owner-session")).toMatchObject({ attempt: { state: "waiting" } });
  });
  return (await service.read("owner-session")).attempt!.id;
}

test("only the initiating session sees and cancels its link; repeated starts and disconnect cannot overlap", async () => {
  const id = await pendingConnection();
  expect(await service.read("other-session")).toMatchObject({ busy: true, attempt: undefined });
  expect(() => service.start("owner-session")).toThrow("already in progress");
  expect(() => service.start("other-session")).toThrow("already in progress");
  await expect(service.disconnect("other-session")).rejects.toThrow("Cancel the current sign-in");
  await expect(service.cancel("other-session", id)).rejects.toThrow("no longer available");
  await expect(service.cancel("owner-session", "stale-id")).rejects.toThrow("no longer available");
  const connection = await service.read("owner-session");
  expect(connection).toMatchObject({ busy: true });
  expect(connection.attempt?.authorizationUrl).toContain("https://auth.openai.com/oauth/authorize?");
  await service.cancel("owner-session", id);
  expect(await service.read("owner-session")).toMatchObject({ busy: false, connected: false, attempt: { state: "cancelled", error: undefined } });
  expect(JSON.stringify(await service.read("owner-session"))).not.toContain("oauth/authorize");
  await expect(service.cancel("owner-session", id)).rejects.toThrow("no longer available");
  service.start("owner-session");
  expect((await service.read("owner-session")).attempt?.id).not.toBe(id);
});

test("expired login clears the link and allows a fresh attempt", async () => {
  await pendingConnection();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  // A fresh attempt installs its deadline on the controlled clock.
  const previous = (await service.read("owner-session")).attempt!;
  await service.cancel("owner-session", previous.id);
  service.start("owner-session");
  await vi.advanceTimersByTimeAsync(15 * 60_000);
  vi.useRealTimers();
  await vi.waitFor(async () => {
    expect(await service.read("owner-session")).toMatchObject({ busy: false, attempt: { state: "failed", error: "The sign-in link expired. Start again to get a new link." } });
  });
});

test("provider failures do not leak response bodies and remain retryable", async () => {
  directory = await mkdtemp(path.join(tmpdir(), "pi-failure-"));
  vi.stubGlobal("fetch", vi.fn(async () => new Response("sensitive-upstream-detail", { status: 500 })));
  service = new PiConnectionService(path.join(directory, "auth.json"), "openai-codex");
  service.start("owner");
  await vi.waitFor(async () => expect(await service.read("owner")).toMatchObject({ attempt: { state: "waiting" } }));
  const pending = (await service.read("owner")).attempt!;
  const state = new URL(pending.authorizationUrl!).searchParams.get("state");
  await visitCallback(`http://localhost:1455/auth/callback?code=failed-code&state=${state}`);
  await vi.waitFor(async () => expect(await service.read("owner")).toMatchObject({ busy: false, connected: false, attempt: { state: "failed" } }));
  expect(JSON.stringify(await service.read("owner"))).not.toContain("sensitive-upstream-detail");
  expect((await service.read("owner")).attempt?.error).toContain("Could not connect");
  expect(() => service.start("owner")).not.toThrow();
});

test("other configured providers do not start the OpenAI flow", async () => {
  directory = await mkdtemp(path.join(tmpdir(), "pi-provider-"));
  const network = vi.fn();
  vi.stubGlobal("fetch", network);
  service = new PiConnectionService(path.join(directory, "auth.json"), "anthropic");
  expect(await service.read("owner")).toMatchObject({ supported: false, connected: false });
  expect(() => service.start("owner")).toThrow("OpenAI Codex only");
  expect(network).not.toHaveBeenCalled();
  await expect(service.cancel("owner", "missing")).rejects.toThrow("no longer available");
});


test("cancelling a reconnect preserves the previous account and other providers", async () => {
  const id = await pendingConnection();
  const previous = { "openai-codex": { type: "oauth", access: "prior-access", refresh: "prior-refresh", expires: 1900000000000 }, "another-provider": { type: "api_key", key: "other-secret" } };
  await writeFile(path.join(directory, "auth.json"), JSON.stringify(previous));
  expect(await service.read("owner-session")).toMatchObject({ connected: true, busy: true });
  await service.cancel("owner-session", id);
  expect(await service.read("owner-session")).toMatchObject({ connected: true, busy: false });
  expect(JSON.parse(await readFile(path.join(directory, "auth.json"), "utf8"))).toEqual(previous);
  await service.disconnect("owner-session");
  expect(JSON.parse(await readFile(path.join(directory, "auth.json"), "utf8"))).toEqual({ "another-provider": previous["another-provider"] });
});

test("storage failures show a safe error instead of reporting a successful disconnect", async () => {
  directory = await mkdtemp(path.join(tmpdir(), "pi-storage-"));
  const authPath = path.join(directory, "auth.json");
  await mkdir(authPath);
  service = new PiConnectionService(authPath, "openai-codex");
  expect((await service.read("owner")).error).toContain("could not be read");
  await service.disconnect("owner");
  expect(await service.read("owner")).toMatchObject({ attempt: { state: "failed", error: "Could not remove the saved connection. Try again." } });
});
