import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, test } from "vitest";

import { requestHttp, waitForHttpResponse } from "./support/http";
import { offArchive, offWithBasis, offJsonlArchive } from "./support/off-archive";

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
  const apiKey = "deployment-secret-api-key";
  const applicationPassword = "deployment-secret-password";
  const running = startProductionProcess({
    APPLICATION_URL: undefined,
    EXAMPLE_API_KEY: apiKey,
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
      timestamp: expect.any(String) as unknown,
    }),
  ]);
});

test.each([undefined, "0.0.0.0/0", "invalid"])("production starts with obsolete proxy value %s", async (TRUST_PROXY) => {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-config-"));
  temporaryDirectories.push(directory);
  const port = await availablePort();
  const running = startProductionProcess({ APPLICATION_URL: "https://calories.example.test", DATABASE_PATH: path.join(directory, "application.sqlite"), PORT: String(port), TRUST_PROXY });
  expect((await waitForHttpResponse(`http://127.0.0.1:${port}/health/live`)).status).toBe(200);
  running.child.kill("SIGTERM");
  await waitForExit(running.child);
  expect(parseJsonLines(running.stderr()).filter(line => line.event === "configuration_deprecated")).toHaveLength(TRUST_PROXY === undefined ? 0 : 1);
});

test("the Tunnel listener resolves HTTPS mutations without trusting forwarded protocol", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-proxy-action-"));
  temporaryDirectories.push(directory);
  const port = await availablePort();
  startProductionProcess({
    APPLICATION_URL: "https://calories.example.test",
    DATABASE_PATH: path.join(directory, "application.sqlite"),
    NODE_ENV: "production",
    PORT: String(port),
    TRUST_PROXY: "127.0.0.1/32",
  });

  await waitForHttpResponse(`http://127.0.0.1:${port}/health/live`);
  const response = await requestHttp(`http://127.0.0.1:${port}/register.data`, {
    body: "",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Host: "calories.example.test",
      Origin: "https://calories.example.test",
      "X-Forwarded-Host": "calories.example.test:443",
      "X-Forwarded-Proto": "http",
      "CF-Connecting-IP": "2001:db8::10",
    },
    method: "POST",
  });

  expect(response.status).toBe(403);
  expect(await response.text()).toContain("CSRF token rejected.");
});

test.each(["csv", "jsonl"])("the compiled OFF command imports %s through the running application", async format => {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-command-"));
  temporaryDirectories.push(directory);
  const catalogDirectory = path.join(directory, "catalogs");
  const archivePath = path.join(directory, `products.${format}.gz`);
  await writeFile(archivePath, format === "csv" ? offArchive([offWithBasis("100g")]) : offJsonlArchive([{ code: "0643843715887", product_name: "Native serving", nutriments: { "energy-kcal_serving": 150, proteins_serving: 30 } }]));
  const port = await availablePort();
  const environment = {
    ...process.env,
    APPLICATION_URL: "https://calories.example.test",
    CATALOG_DIRECTORY: catalogDirectory,
    DATABASE_PATH: path.join(directory, "application.sqlite"),
    NODE_ENV: "production",
    OFF_CATALOG_MAX_DATABASE_BYTES: String(16 * 1024 * 1024),
    OFF_CATALOG_MAX_EXPANDED_BYTES: String(16 * 1024 * 1024),
    OFF_CATALOG_MAX_UPLOAD_BYTES: String(2 * 1024 * 1024),
    PORT: String(port),
    TRUST_PROXY: "172.30.0.0/16",
  };
  const running = startProductionProcess(environment);
  await waitForHttpResponse(`http://127.0.0.1:${port}/health/ready`);

  const imported = await executeFile(
    "pnpm",
    ["catalog:import:off", "--", archivePath],
    { cwd: process.cwd(), env: environment },
  );

  expect(imported.stderr).not.toContain("import failed");
  expect(imported.stdout).toContain("Open Food Facts: succeeded; 1 foods installed");
  running.child.kill("SIGTERM");
  await waitForExit(running.child);
});

test("production health and logs are safe on a configurable internal port", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-server-"));
  temporaryDirectories.push(directory);
  const port = await availablePort();
  const apiKey = "deployment-secret-api-key";
  const password = "deployment-secret-password";
  const sessionToken = "deployment-secret-session-token";
  const csrfToken = "deployment-secret-csrf-token";
  const searchIdentity = "private-owner-and-food-query";
  const running = startProductionProcess({
    APPLICATION_URL: "https://calories.example.test",
    DATABASE_PATH: path.join(directory, "application.sqlite"),
    EXAMPLE_API_KEY: apiKey,
    PORT: String(port),
    TRUST_PROXY: "172.30.0.0/16",
  });

  const liveness = await waitForHttpResponse(
    `http://127.0.0.1:${port}/health/live`,
  );
  expect(liveness.status).toBe(200);
  expect(await liveness.json()).toEqual({ status: "live" });

  const readiness = await requestHttp(`http://127.0.0.1:${port}/health/ready`);
  expect(readiness.status).toBe(200);
  expect(await readiness.json()).toEqual({ status: "ready" });

  const requestId = "deployment-health-request";
  const loggedRequest = await requestHttp(
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
        timestamp: expect.any(String) as unknown,
      }),
      expect.objectContaining({
        event: "request_completed",
        method: "GET",
        path: "/health/live",
        requestId,
        status: 200,
        timestamp: expect.any(String) as unknown,
      }),
    ]),
  );
});

 test("Tunnel visitor failures stay separate from LAN and health", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-entries-"));
  temporaryDirectories.push(directory);
  const port = await availablePort();
  const lanPort = await availablePort();
  const running = startProductionProcess({ APPLICATION_URL: "https://calories.example.test", DATABASE_PATH: path.join(directory, "application.sqlite"), PORT: String(port), LAN_PORT: String(lanPort), LAN_URL: `http://127.0.0.1:${lanPort}`, TRUST_PROXY: "invalid" });
  await waitForHttpResponse(`http://127.0.0.1:${port}/health/live`);
  await waitForHttpResponse(`http://127.0.0.1:${lanPort}/health/live`);
  for (const visitorIp of [undefined, "", "not-an-ip", "203.0.113.1, 203.0.113.2"]) {
    const response = await requestHttp(`http://127.0.0.1:${port}/login`, { headers: { Host: "calories.example.test", ...(visitorIp === undefined ? {} : { "CF-Connecting-IP": visitorIp }) } });
    expect(response.status).toBe(503);
    expect(await response.text()).toContain("Public connection could not be verified.");
    expect(response.headers.get("set-cookie")).toBeNull();
  }
  for (const visitorIp of ["203.0.113.1", "2001:db8::123"]) {
    const response = await requestHttp(`http://127.0.0.1:${port}/register`, { headers: { Host: "calories.example.test", "CF-Connecting-IP": visitorIp } });
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("__Host-calorie_auth_csrf=");
  }
  const lan = await requestHttp(`http://127.0.0.1:${lanPort}/register`, { headers: { "CF-Connecting-IP": "invalid", "X-Forwarded-For": "203.0.113.50", "X-Forwarded-Proto": "https", "X-Forwarded-Host": "calories.example.test", "X-Open-Calory-Client-IP": "chosen-by-client" } });
  expect(lan.status).toBe(200);
  expect(lan.headers.get("set-cookie")).toContain("calorie_lan_auth_csrf=");
  expect(lan.headers.get("set-cookie")).not.toContain("Secure");
  for (const [url, Host] of [[`http://127.0.0.1:${port}/login`, `127.0.0.1:${lanPort}`], [`http://127.0.0.1:${lanPort}/login`, "calories.example.test"], [`http://127.0.0.1:${port}/login`, "calories.example.test.attacker.invalid"]]) {
    expect((await requestHttp(url, { headers: { Host, "CF-Connecting-IP": "203.0.113.10" } })).status).toBe(421);
  }
  running.child.kill("SIGTERM");
  await waitForExit(running.child);
  expect(parseJsonLines(running.stderr()).filter(line => line.event === "public_connection_rejected").map(line => line.reason)).toEqual(["missing-visitor-ip", "invalid-visitor-ip", "invalid-visitor-ip", "invalid-visitor-ip"]);
 });

 test("rate limits use visitor IP on Tunnel and ignore all forwarded IPs on LAN", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-entry-limits-"));
  temporaryDirectories.push(directory);
  const port = await availablePort();
  const lanPort = await availablePort();
  const tunnelUrl = `http://127.0.0.1:${port}`;
  const lanUrl = `http://127.0.0.1:${lanPort}`;
  const running = startProductionProcess({ APPLICATION_URL: "https://calories.example.test", DATABASE_PATH: path.join(directory, "application.sqlite"), PORT: String(port), LAN_PORT: String(lanPort), LAN_URL: lanUrl, TRUST_PROXY: undefined });
  await waitForHttpResponse(`${tunnelUrl}/health/live`);
  await waitForHttpResponse(`${lanUrl}/health/live`);
  const claim = await requestHttp(`${tunnelUrl}/register`, { headers: { Host: "calories.example.test", "CF-Connecting-IP": "203.0.113.3" } });
  const claimCsrf = /name="csrfToken" value="([^"]+)"/.exec(await claim.text())?.[1];
  if (!claimCsrf) throw new Error("Registration omitted CSRF token");
  const claimed = await requestHttp(`${tunnelUrl}/register`, { method: "POST", headers: { Host: "calories.example.test", Origin: "https://calories.example.test", "CF-Connecting-IP": "203.0.113.3", Cookie: claim.headers.getSetCookie()[0].split(";", 1)[0], "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ csrfToken: claimCsrf, username: "limit.admin", password: "correct horse battery staple", confirmPassword: "correct horse battery staple" }).toString() });
  expect(claimed.status).toBe(302);
  for (const [url, origin, host, username] of [[tunnelUrl, "https://calories.example.test", "calories.example.test", "tunnel.user"], [lanUrl, lanUrl, `127.0.0.1:${lanPort}`, "lan.user"]]) {
    const initial = await requestHttp(`${url}/login`, { headers: { Host: host, "CF-Connecting-IP": "203.0.113.1" } });
    const csrfToken = /name="csrfToken" value="([^"]+)"/.exec(await initial.text())?.[1];
    if (!csrfToken) throw new Error("Registration omitted CSRF token");
    const Cookie = initial.headers.getSetCookie()[0].split(";", 1)[0];
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 11; attempt++) {
      const response = await requestHttp(`${url}/login`, { method: "POST", headers: { Host: host, Origin: origin, Cookie, "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": url === tunnelUrl ? "203.0.113.1" : `203.0.113.${attempt + 1}`, "X-Forwarded-For": `203.0.113.${attempt + 1}`, "X-Open-Calory-Client-IP": `spoofed-${attempt}` }, body: new URLSearchParams({ csrfToken, username, password: "incorrect password" }).toString() });
      statuses.push(response.status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 401, 401, 401, 401, 401, 429]);
    const otherVisitor = await requestHttp(`${url}/login`, { method: "POST", headers: { Host: host, Origin: origin, Cookie, "Content-Type": "application/x-www-form-urlencoded", "CF-Connecting-IP": "2001:db8::2" }, body: new URLSearchParams({ csrfToken, username, password: "incorrect password" }).toString() });
    expect(otherVisitor.status).toBe(url === tunnelUrl ? 401 : 429);
  }
  running.child.kill("SIGTERM");
  await waitForExit(running.child);
 });

test("an accepted IPv6 LAN origin reaches its listener and enforces its authority", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "calory-ipv6-lan-"));
  temporaryDirectories.push(directory);
  const port = await availablePort();
  const lanPort = await availablePort();
  startProductionProcess({ APPLICATION_URL: "https://calories.example.test", DATABASE_PATH: path.join(directory, "application.sqlite"), PORT: String(port), LAN_PORT: String(lanPort), LAN_URL: `http://[::1]:${lanPort}`, TRUST_PROXY: undefined });
  await waitForHttpResponse(`http://127.0.0.1:${port}/health/live`);
  await waitForHttpResponse(`http://[::1]:${lanPort}/health/live`, { timeoutMs: 1000 });
  const registration = await requestHttp(`http://[::1]:${lanPort}/register`);
  expect(registration.status).toBe(200);
  expect(registration.headers.getSetCookie()[0]).toContain("calorie_lan_auth_csrf=");
  const rejected = await requestHttp(`http://[::1]:${lanPort}/register`, { headers: { Host: `127.0.0.1:${lanPort}` } });
  expect(rejected.status).toBe(421);
});
