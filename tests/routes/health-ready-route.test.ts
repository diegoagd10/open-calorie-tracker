import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type BetterSqlite3 from "better-sqlite3";
import { afterAll, beforeAll, expect, test } from "vitest";

import {
  getApplicationDatabase,
  initializeApplicationDatabase,
  shutdownApplicationDatabase,
} from "../../app/database/runtime.server";
import { loader } from "../../app/routes/health.ready";

let temporaryDirectory: string;

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), "calory-ready-route-"));
  process.env.DATABASE_PATH = path.join(temporaryDirectory, "application.sqlite");
  initializeApplicationDatabase();
});

afterAll(async () => {
  shutdownApplicationDatabase();
  await rm(temporaryDirectory, { force: true, recursive: true });
  delete process.env.DATABASE_PATH;
});

test("readiness reports ready, failed invariants, and inaccessible storage", async () => {
  const ready = loader();
  expect(ready.status).toBe(200);
  expect(ready.headers.get("cache-control")).toBe("no-store");
  await expect(ready.json()).resolves.toEqual({ status: "ready" });

  const client = getApplicationDatabase().getClient() as unknown as {
    $client: BetterSqlite3.Database;
  };
  client.$client.pragma("foreign_keys = OFF");
  const notReady = loader();
  expect(notReady.status).toBe(503);
  expect(notReady.headers.get("cache-control")).toBe("no-store");
  await expect(notReady.json()).resolves.toEqual({ status: "not_ready" });
  client.$client.pragma("foreign_keys = ON");

  getApplicationDatabase().close();
  const inaccessible = loader();
  expect(inaccessible.status).toBe(503);
  expect(inaccessible.headers.get("cache-control")).toBe("no-store");
  await expect(inaccessible.json()).resolves.toEqual({ status: "not_ready" });
});
