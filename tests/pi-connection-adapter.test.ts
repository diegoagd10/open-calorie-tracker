import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { CredentialSynchronizationError, type ModelRuntime } from "@earendil-works/pi-coding-agent";
import { PiConnectionService } from "../app/photo-analysis/pi-connection.server";

const sdk = vi.hoisted(() => ({ create: vi.fn(), login: vi.fn(), logout: vi.fn(), listCredentials: vi.fn() }));
vi.mock("@earendil-works/pi-coding-agent", async original => ({
  ...await original<typeof import("@earendil-works/pi-coding-agent")>(),
  ModelRuntime: { create: sdk.create },
}));
let service: PiConnectionService;
let interaction: Parameters<ModelRuntime["login"]>[2];
let finish: () => void;
let credentials: { providerId: string; type: "oauth" }[];
beforeEach(() => {
  vi.clearAllMocks();
  credentials = [];
  sdk.create.mockResolvedValue({ login: sdk.login, logout: sdk.logout, listCredentials: sdk.listCredentials });
  sdk.listCredentials.mockImplementation(async () => credentials);
  sdk.logout.mockImplementation(async () => { credentials = []; });
  sdk.login.mockImplementation(async (_provider, _type, next: typeof interaction) => {
    interaction = next;
    await new Promise<void>((resolve, reject) => {
      finish = resolve;
      next.signal?.addEventListener("abort", () => reject(new Error("Login aborted")), { once: true });
    });
    credentials = [{ providerId: "openai-codex", type: "oauth" }];
  });
  service = new PiConnectionService("/private/app/auth.json", "openai-codex");
});
afterEach(() => { service.shutdown(); vi.useRealTimers(); });
async function start() {
  service.start("owner");
  await vi.waitFor(() => expect(sdk.login).toHaveBeenCalled());
}

test("Pi receives the configured private store without model discovery, and only device-code prompts are accepted", async () => {
  await start();
  expect(sdk.create).toHaveBeenCalledExactlyOnceWith({ authPath: "/private/app/auth.json", modelsPath: null, allowModelNetwork: false, refreshOnCreate: false });
  expect(sdk.login).toHaveBeenCalledWith("openai-codex", "oauth", expect.any(Object));
  await expect(interaction.prompt({ type: "select", message: "Method", options: [{ id: "browser", label: "Browser" }, { id: "device_code", label: "Code" }] })).resolves.toBe("device_code");
  await expect(interaction.prompt({ type: "select", message: "Unknown", options: [{ id: "browser", label: "Browser" }] })).rejects.toThrow("Device sign-in unavailable");
  await expect(interaction.prompt({ type: "secret", message: "Password" })).rejects.toThrow("Device sign-in unavailable");
  const state = await service.read("owner");
  expect(state).toMatchObject({ busy: true, attempt: { state: "starting" } });
  expect(state.attempt?.id).toMatch(/^[\da-f-]{36}$/);
  expect(sdk.listCredentials).toHaveBeenCalledWith({ signal: expect.any(AbortSignal) as AbortSignal });
  await service.cancel("owner", state.attempt!.id);
});

test("provider messages and unsafe verification links never become browser content, and cancellation ignores late notifications", async () => {
  await start();
  interaction.notify({ type: "info", message: "secret-provider-output" });
  expect((await service.read("owner")).attempt).not.toHaveProperty("userCode");
  expect(() => interaction.notify({ type: "device_code", userCode: "1234", verificationUri: "https://evil.example" })).toThrow("Unexpected verification address");
  const now = Date.now();
  interaction.notify({ type: "device_code", userCode: "SAFE-1234", verificationUri: "https://auth.openai.com/codex/device" });
  const state = await service.read("owner");
  expect(state.attempt).toMatchObject({ userCode: "SAFE-1234", state: "waiting" });
  expect(Date.parse(state.attempt!.expiresAt!)).toBeGreaterThanOrEqual(now + 15 * 60_000);
  expect(Date.parse(state.attempt!.expiresAt!)).toBeLessThan(now + 15 * 60_000 + 1000);
  await service.cancel("owner", state.attempt!.id);
  interaction.notify({ type: "device_code", userCode: "LATE-1234", verificationUri: "https://auth.openai.com/codex/device" });
  expect(await service.read("owner")).toMatchObject({ busy: false, attempt: { state: "cancelled" } });
  const cancelled = await service.read("owner");
  expect(cancelled.attempt?.userCode).toBeUndefined();
  expect(JSON.stringify(cancelled)).not.toContain("SAFE-1234");
  expect(JSON.stringify(cancelled)).not.toContain("LATE-1234");
});

test("SDK initialization and metadata read failures stay private and can be retried", async () => {
  sdk.create.mockRejectedValueOnce(new Error("private-path"));
  expect((await service.read("owner")).error).toContain("could not be read");
  credentials = [{ providerId: "different-provider", type: "oauth" }];
  expect(await service.read("owner")).toMatchObject({ connected: false, error: undefined });
  expect(sdk.create).toHaveBeenCalledTimes(2);
  credentials = [{ providerId: "openai-codex", type: "oauth" }];
  expect(await service.read("owner")).toMatchObject({ connected: true });
});

test("shutdown aborts a pending login and completed operations release their deadline", async () => {
  vi.useFakeTimers();
  await start();
  expect(vi.getTimerCount()).toBe(1);
  finish();
  await vi.waitFor(async () => expect((await service.read("owner")).attempt?.state).toBe("connected"));
  expect(vi.getTimerCount()).toBe(0);
  sdk.login.mockClear();
  await start();
  service.shutdown();
  expect(interaction.signal?.aborted).toBe(true);
  await vi.waitFor(async () => expect((await service.read("owner")).busy).toBe(false));
  expect(vi.getTimerCount()).toBe(0);
});

test("disconnect is exclusive and cannot be cancelled as if it were a sign-in", async () => {
  let release!: () => void;
  sdk.logout.mockImplementationOnce(async () => { await new Promise<void>(resolve => { release = resolve; }); });
  const disconnect = service.disconnect("owner");
  await vi.waitFor(() => expect(sdk.logout).toHaveBeenCalled());
  const state = await service.read("owner");
  expect(state).toMatchObject({ busy: true, attempt: { state: "disconnecting" } });
  expect(state.attempt?.id).toMatch(/^[\da-f-]{36}$/);
  expect(sdk.logout).toHaveBeenCalledWith("openai-codex", { signal: expect.any(AbortSignal) as AbortSignal });
  expect(() => service.start("owner")).toThrow("already in progress");
  await expect(service.cancel("owner", state.attempt!.id)).rejects.toThrow("no longer available");
  release();
  await disconnect;
  expect(await service.read("owner")).toMatchObject({ busy: false, attempt: { state: "cancelled" } });
});

test("a committed sign-in remains successful if cancellation interrupts Pi's subsequent synchronization", async () => {
  sdk.login.mockImplementationOnce(async (_provider, _type, next: typeof interaction) => {
    interaction = next;
    credentials = [{ providerId: "openai-codex", type: "oauth" }];
    await new Promise<void>(resolve => next.signal?.addEventListener("abort", () => resolve(), { once: true }));
    throw new CredentialSynchronizationError("openai-codex", "login", { type: "oauth", access: "synthetic", refresh: "synthetic", expires: 1900000000000 }, { cause: new Error("cancelled after persistence") });
  });
  await start();
  await service.cancel("owner", (await service.read("owner")).attempt!.id);
  expect(await service.read("owner")).toMatchObject({ connected: true, busy: false, attempt: { state: "connected" } });
});

test("a committed disconnect succeeds even if Pi's subsequent synchronization fails", async () => {
  sdk.logout.mockRejectedValueOnce(new CredentialSynchronizationError("openai-codex", "logout", undefined, { cause: new Error("synchronization failed") }));
  await service.disconnect("owner");
  expect(await service.read("owner")).toMatchObject({ connected: false, busy: false, attempt: { state: "cancelled" } });
});
