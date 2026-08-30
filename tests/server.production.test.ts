import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, test } from "vitest";

import { waitForHttpResponse } from "./support/deployment";

const executeFile = promisify(execFile);
const temporaryDirectories: string[] = [];
const processes: ChildProcessWithoutNullStreams[] = [];

type RunningProcess = {
  child: ChildProcessWithoutNullStreams;
  stderr(): string;
  stdout(): string;
};

beforeAll(async () => {
  await executeFile("pnpm", ["build"], { cwd: process.cwd() });
});

afterAll(async () => {
  for (const child of processes) {
    if (child.exitCode === null) child.kill("SIGTERM");
  }
  await Promise.all(
    temporaryDirectories.map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

async function availablePort(): Promise<number> {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("could not reserve a test port");
  }
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  return address.port;
}

function startProductionProcess(environment: NodeJS.ProcessEnv): RunningProcess {
  const child = spawn(process.execPath, ["server.js"], {
    cwd: process.cwd(),
    env: { ...process.env, NODE_ENV: "production", ...environment },
    stdio: "pipe",
  });
  processes.push(child);
  child.stderr.setEncoding("utf8");
  child.stdout.setEncoding("utf8");
  let stderr = "";
  let stdout = "";
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  return { child, stderr: () => stderr, stdout: () => stdout };
}

async function waitForExit(
  child: ChildProcessWithoutNullStreams,
  timeoutMs = 10_000,
) {
  return await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolve, reject) => {
      const timeout = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
      child.once("error", reject);
      child.once("exit", (code, signal) => {
        clearTimeout(timeout);
        resolve({ code, signal });
      });
    },
  );
}

function parseJsonLines(output: string): Array<Record<string, unknown>> {
  return output
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

test("missing production configuration exits with a redacted structured log", async () => {
  const apiKey = "deployment-secret-usda-key";
  const applicationPassword = "deployment-secret-password";
  const running = startProductionProcess({
    APPLICATION_URL: undefined,
    FDC_API_KEY: apiKey,
    OWNER_PASSWORD: applicationPassword,
  });

  const exit = await waitForExit(running.child);

  expect(exit.code).not.toBe(0);
  expect(running.stderr()).not.toContain(apiKey);
  expect(running.stderr()).not.toContain(applicationPassword);
  expect(parseJsonLines(running.stderr())).toEqual([
    expect.objectContaining({
      event: "startup_failed",
      level: "error",
      timestamp: expect.any(String),
    }),
  ]);
});

test("public forwarded-header trust prevents production startup", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-config-"));
  temporaryDirectories.push(directory);
  const running = startProductionProcess({
    APPLICATION_URL: "https://calories.example.test",
    DATABASE_PATH: path.join(directory, "application.sqlite"),
    PORT: String(await availablePort()),
    TRUST_PROXY: "0.0.0.0/0",
  });

  const exit = await waitForExit(running.child, 1_000);

  expect(exit.code).not.toBe(0);
  expect(parseJsonLines(running.stderr())).toEqual([
    expect.objectContaining({
      event: "startup_failed",
      level: "error",
    }),
  ]);
});

test("production health and logs are safe on a configurable internal port", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-server-"));
  temporaryDirectories.push(directory);
  const port = await availablePort();
  const apiKey = "deployment-secret-usda-key";
  const password = "deployment-secret-password";
  const sessionToken = "deployment-secret-session-token";
  const csrfToken = "deployment-secret-csrf-token";
  const searchIdentity = "private-owner-and-food-query";
  const running = startProductionProcess({
    APPLICATION_URL: "https://calories.example.test",
    DATABASE_PATH: path.join(directory, "application.sqlite"),
    FDC_API_KEY: apiKey,
    PORT: String(port),
    TRUST_PROXY: "172.30.0.0/16",
  });

  const liveness = await waitForHttpResponse(
    `http://127.0.0.1:${port}/health/live`,
  );
  expect(liveness.status).toBe(200);
  expect(await liveness.json()).toEqual({ status: "live" });

  const readiness = await fetch(`http://127.0.0.1:${port}/health/ready`);
  expect(readiness.status).toBe(200);
  expect(await readiness.json()).toEqual({ status: "ready" });

  const requestId = "deployment-health-request";
  const loggedRequest = await fetch(
    `http://127.0.0.1:${port}/health/live?username=${searchIdentity}&password=${password}&csrfToken=${csrfToken}`,
    {
      headers: {
        Cookie: `__Host-calorie_session=${sessionToken}`,
        "X-Request-ID": requestId,
      },
    },
  );
  expect(loggedRequest.headers.get("x-request-id")).toBe(requestId);

  running.child.kill("SIGTERM");
  await waitForExit(running.child);

  const output = `${running.stdout()}\n${running.stderr()}`;
  for (const secret of [
    apiKey,
    password,
    sessionToken,
    csrfToken,
    searchIdentity,
  ]) {
    expect(output).not.toContain(secret);
  }
  const logs = parseJsonLines(running.stdout());
  expect(logs).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        environment: "production",
        event: "server_started",
        level: "info",
        port,
        timestamp: expect.any(String),
      }),
      expect.objectContaining({
        event: "request_completed",
        method: "GET",
        path: "/health/live",
        requestId,
        status: 200,
        timestamp: expect.any(String),
      }),
    ]),
  );
});
