import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const fallowBinary = path.join(repositoryRoot, "node_modules", ".bin", "fallow");
const repositoryConfig = JSON.parse(
  await readFile(path.join(repositoryRoot, ".fallowrc.json"), "utf8"),
);

async function createFixture(t, entry, files) {
  const fixtureRoot = await mkdtemp(
    path.join(tmpdir(), "open-calory-fallow-architecture-"),
  );
  t.after(() => rm(fixtureRoot, { force: true, recursive: true }));

  const config = {
    boundaries: repositoryConfig.boundaries,
    entry: [entry],
    rules: repositoryConfig.rules,
  };

  await writeFile(
    path.join(fixtureRoot, ".fallowrc.json"),
    `${JSON.stringify(config, null, 2)}\n`,
  );
  await writeFile(
    path.join(fixtureRoot, "package.json"),
    '{"private":true,"type":"module"}\n',
  );

  await Promise.all(
    Object.entries(files).map(async ([relativePath, source]) => {
      const target = path.join(fixtureRoot, relativePath);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, source);
    }),
  );

  return fixtureRoot;
}

function runFallow(fixtureRoot, filter) {
  const result = spawnSync(
    fallowBinary,
    [
      "dead-code",
      filter,
      "--root",
      fixtureRoot,
      "--config",
      path.join(fixtureRoot, ".fallowrc.json"),
      "--format",
      "json",
      "--quiet",
      "--no-cache",
    ],
    { encoding: "utf8" },
  );

  assert.equal(
    result.error,
    undefined,
    `Fallow could not run: ${result.error?.message ?? result.stderr}`,
  );
  assert.equal(
    result.status,
    1,
    `expected Fallow exit code 1, received ${result.status}\n${result.stderr}\n${result.stdout}`,
  );
  return JSON.parse(result.stdout);
}

test("a forbidden feature import returns exit code 1", async (t) => {
  const fixtureRoot = await createFixture(t, "app/database/probe.ts", {
    "app/auth/probe.ts": "export const authProbe = true;\n",
    "app/database/probe.ts":
      'import { authProbe } from "../auth/probe";\nexport const databaseProbe = authProbe;\n',
  });

  const report = runFallow(fixtureRoot, "--boundary-violations");

  assert.equal(report.summary.boundary_violations, 1);
  assert.equal(report.boundary_violations[0].from_zone, "database");
  assert.equal(report.boundary_violations[0].to_zone, "auth");
});

test("a circular dependency returns exit code 1", async (t) => {
  const fixtureRoot = await createFixture(t, "app/auth/a.ts", {
    "app/auth/a.ts":
      'import { b } from "./b";\nexport const a = b === "b" ? "a" : "a";\n',
    "app/auth/b.ts":
      'import { a } from "./a";\nexport const b = a === "a" ? "b" : "b";\n',
  });

  const report = runFallow(fixtureRoot, "--circular-deps");

  assert.equal(report.summary.circular_dependencies, 1);
});

test("an unzoned source file returns exit code 1", async (t) => {
  const fixtureRoot = await createFixture(t, "app/root.tsx", {
    "app/orphan.ts": "export const orphan = true;\n",
    "app/root.tsx":
      'import { orphan } from "./orphan";\nexport default function Root() { return orphan; }\n',
  });

  const report = runFallow(fixtureRoot, "--boundary-violations");

  assert.equal(report.summary.boundary_coverage_violations, 1);
  assert.equal(report.boundary_coverage_violations[0].path, "app/orphan.ts");
});

test("production side effects outside their owners return exit code 1", async (t) => {
  const fixtureRoot = await createFixture(t, "app/routes/probe.ts", {
    "app/routes/probe.ts": [
      'import { execFileSync } from "node:child_process";',
      'import { readFileSync } from "node:fs";',
      'import { drizzle } from "drizzle-orm/better-sqlite3";',
      'fetch("https://example.test");',
      'readFileSync("example.txt");',
      'execFileSync("example");',
      "drizzle({});",
      "process.exit(1);",
    ].join("\n"),
  });

  const report = runFallow(fixtureRoot, "--boundary-violations");

  assert.equal(
    report.summary.boundary_call_violations,
    5,
    JSON.stringify(report.boundary_call_violations, null, 2),
  );
});

test("browser ceremony transport may fetch without widening server authentication side effects", async (t) => {
  const fixtureRoot = await createFixture(t, "app/routes/probe.ts", {
    "app/routes/probe.ts": 'import { browserTransport } from "../auth/probe.client";\nimport { serverTransport } from "../auth/probe.server";\nexport const probe = [browserTransport, serverTransport];\n',
    "app/auth/probe.client.ts": 'export function browserTransport() { return fetch("/key-ceremony"); }\n',
    "app/auth/probe.server.ts": 'export function serverTransport() { return fetch("https://example.test"); }\n',
  });
  const report = runFallow(fixtureRoot, "--boundary-violations");
  assert.equal(report.summary.boundary_call_violations, 1);
  assert.equal(report.boundary_call_violations[0].path, "app/auth/probe.server.ts");
});

test("browser ceremony transport cannot import account storage", async (t) => {
  const fixtureRoot = await createFixture(t, "app/auth/probe.client.ts", {
    "app/auth/probe.client.ts": 'import { account } from "../database/probe";\nexport const browserAccount = account;\n',
    "app/database/probe.ts": 'export const account = 1;\n',
  });
  const report = runFallow(fixtureRoot, "--boundary-violations");
  assert.equal(report.summary.boundary_violations, 1);
  assert.equal(report.boundary_violations[0].from_zone, "browser-auth");
  assert.equal(report.boundary_violations[0].to_zone, "database");
});
