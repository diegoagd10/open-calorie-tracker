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
