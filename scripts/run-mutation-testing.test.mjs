import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const runner = path.resolve("scripts/run-mutation-testing.mjs");

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "mutation-runner-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, "mutation-testing"));
  await mkdir(path.join(directory, "bin"));
  const report = (status) => ({
    files: { "app/example.ts": { mutants: [{ status, mutatorName: "BooleanLiteral" }] } },
  });
  await writeFile(path.join(directory, "mutation-testing/stryker-incremental.json"), JSON.stringify(report("Killed")));
  await writeFile(path.join(directory, "mutation-testing/baseline-summary.json"), JSON.stringify({ mutationScore: 100, counts: { detected: 1, valid: 1 } }));
  // Exercise the real orchestration without running thousands of mutants. The
  // stand-in records which seed Stryker receives and produces a complete report.
  await writeFile(path.join(directory, "bin/pnpm"), `#!${process.execPath}
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
const seed = 'reports/stryker-incremental.json';
writeFileSync('reports/invocation.json', JSON.stringify({ args: process.argv.slice(2), seed: existsSync(seed) ? JSON.parse(readFileSync(seed, 'utf8')) : null }));
if (process.env.STUB_CRASH) process.exit(1);
const report = ${JSON.stringify(report("Survived"))};
writeFileSync(seed, JSON.stringify(report));
writeFileSync('reports/mutation/mutation.json', JSON.stringify(report));
`);
  await chmod(path.join(directory, "bin/pnpm"), 0o755);
  return {
    directory,
    run(args = [], environment = {}) {
      return spawnSync(process.execPath, [runner, ...args], {
        cwd: directory,
        env: { ...process.env, MUTATION_SCORE_THRESHOLD: "94.8", PATH: `${directory}/bin:${process.env.PATH}`, ...environment },
        encoding: "utf8",
      });
    },
    async invocation() {
      return JSON.parse(await readFile(path.join(directory, "reports/invocation.json"), "utf8"));
    },
  };
}

test("reuses completed results even when the score gate failed", async (t) => {
  const f = await fixture(t);
  assert.match(f.run().stderr, /below the required/);
  assert.equal((await f.invocation()).seed.files["app/example.ts"].mutants[0].status, "Killed");
  assert.match(f.run().stderr, /below the required/);
  assert.equal((await f.invocation()).seed.files["app/example.ts"].mutants[0].status, "Survived");
  assert.equal(JSON.parse(await readFile(path.join(f.directory, "mutation-testing/baseline-summary.json"))).mutationScore, 100);
});

test("forces remeasurement after an indirect test input changes", async (t) => {
  const f = await fixture(t);
  f.run();
  await mkdir(path.join(f.directory, "tests/support"), { recursive: true });
  await writeFile(path.join(f.directory, "tests/support/fixture.ts"), "export const value = 2;");
  f.run();
  assert.ok((await f.invocation()).args.includes("--force"));
});

test("lets Stryker compare changed production code and test cases incrementally", async (t) => {
  const f = await fixture(t);
  f.run();
  await mkdir(path.join(f.directory, "app"));
  await mkdir(path.join(f.directory, "tests"));
  await writeFile(path.join(f.directory, "app/example.ts"), "export const value = false;");
  await writeFile(path.join(f.directory, "tests/example.test.ts"), "test('changed', () => {});");
  f.run();
  const invocation = await f.invocation();
  assert.equal(invocation.args.includes("--force"), false);
  assert.equal(invocation.seed.files["app/example.ts"].mutants[0].status, "Survived");
});

test("explicit baseline recording discards the incremental cache", async (t) => {
  const f = await fixture(t);
  f.run();
  f.run(["--record-baseline"]);
  const invocation = await f.invocation();
  assert.equal(invocation.seed, null);
  assert.ok(invocation.args.includes("--force"));
});

test("invalidates reuse when dependencies change or fixtures are removed", async (t) => {
  const f = await fixture(t);
  await writeFile(path.join(f.directory, "pnpm-lock.yaml"), "version: 1");
  f.run();
  await writeFile(path.join(f.directory, "pnpm-lock.yaml"), "version: 2");
  f.run();
  assert.ok((await f.invocation()).args.includes("--force"));
  await rm(path.join(f.directory, "pnpm-lock.yaml"));
  f.run();
  assert.ok((await f.invocation()).args.includes("--force"));
});

test("a crashed Stryker run cannot publish cache eligibility or a stale score report", async (t) => {
  const f = await fixture(t);
  f.run();
  const result = f.run([], { STUB_CRASH: "1" });
  assert.match(result.stderr, /Stryker exited with code 1/);
  await assert.rejects(readFile(path.join(f.directory, "reports/stryker-context.txt")), { code: "ENOENT" });
  await assert.rejects(readFile(path.join(f.directory, "reports/mutation/mutation.json")), { code: "ENOENT" });
});

test("cached results still fail the baseline regression gate without a threshold", async (t) => {
  const f = await fixture(t);
  f.run();
  const result = f.run([], { MUTATION_SCORE_THRESHOLD: undefined });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /regressed below the measured baseline/);
  assert.equal((await f.invocation()).seed.files["app/example.ts"].mutants[0].status, "Survived");
});

test("a retry after failed cache invalidation still forces remeasurement", async (t) => {
  const f = await fixture(t);
  f.run();
  await writeFile(path.join(f.directory, "vitest.config.ts"), "export default {};");
  f.run([], { STUB_CRASH: "1" });
  assert.ok((await f.invocation()).args.includes("--force"));
  f.run();
  assert.ok((await f.invocation()).args.includes("--force"));
});

test("browser-only changes do not invalidate Vitest mutation results", async (t) => {
  const f = await fixture(t);
  f.run();
  await mkdir(path.join(f.directory, "tests/browser"), { recursive: true });
  await writeFile(path.join(f.directory, "tests/browser/journey.spec.ts"), "test('browser change', () => {});");
  f.run();
  assert.equal((await f.invocation()).args.includes("--force"), false);
});
