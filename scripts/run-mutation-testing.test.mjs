import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

const runner = path.resolve("scripts/run-mutation-testing.mjs");

function runOptions(directory, environment = {}) {
  return {
    cwd: directory,
    env: { ...process.env, MUTATION_SHARD: undefined, MUTATION_SCORE_THRESHOLD: "94.8", PATH: `${directory}/bin:${process.env.PATH}`, ...environment },
    encoding: "utf8",
  };
}

function runAsync(directory, environment = {}) {
  const child = spawn(process.execPath, [runner], runOptions(directory, environment));
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (data) => { stdout += data; });
  child.stderr.on("data", (data) => { stderr += data; });
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (status) => resolve({ stdout, stderr, status }));
  });
}

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "mutation-runner-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(path.join(directory, "mutation-testing"));
  await mkdir(path.join(directory, "bin"));
  const report = (status) => ({
    files: { "app/example.ts": { source: "export const value = true;", mutants: [{ status, mutatorName: "BooleanLiteral" }] } },
    testFiles: { "tests/example.test.ts": { source: "test('example', () => {});", tests: [] } },
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
report.projectRoot = process.cwd();
report.marker = process.env.STUB_MARKER;
if (process.env.STUB_PENDING) report.files['app/example.ts'].mutants[0].status = 'Pending';
if (process.env.STUB_EMPTY) report.files = {};
if (process.env.STUB_CHANGE_INPUT) writeFileSync('vitest.config.ts', 'export default {};');
writeFileSync(seed, JSON.stringify(report));
writeFileSync('reports/mutation/mutation.json', JSON.stringify(report));
`);
  await chmod(path.join(directory, "bin/pnpm"), 0o755);
  return {
    directory,
    run(args = [], environment = {}) {
      return spawnSync(process.execPath, [runner, ...args], runOptions(directory, environment));
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

async function worktrees(t) {
  const first = await fixture(t);
  const git = (...args) => execFileSync("git", args, {
    cwd: first.directory, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  git("init", "--quiet");
  git("add", "mutation-testing", "bin");
  git("-c", "user.name=Mutation test", "-c", "user.email=mutation@example.invalid", "commit", "--quiet", "-m", "Fixture");
  const second = `${first.directory}-worktree`;
  t.after(() => rm(second, { recursive: true, force: true }));
  git("worktree", "add", "--quiet", "--detach", second);
  return {
    first, second,
    cacheDirectory: path.join(first.directory, ".git/mutation-cache/v1"),
    runSecond(environment = {}) {
      return spawnSync(process.execPath, [runner], runOptions(second, environment));
    },
    async secondInvocation() {
      return JSON.parse(await readFile(path.join(second, "reports/invocation.json"), "utf8"));
    },
  };
}

test("linked worktrees reuse completed reports and still enforce the score gate", async (t) => {
  const w = await worktrees(t);
  assert.match(w.first.run().stderr, /below the required/);
  const result = w.runSecond();
  assert.match(result.stdout, /from another worktree/);
  assert.match(result.stderr, /below the required/);
  const invocation = await w.secondInvocation();
  assert.equal(invocation.args.includes("--force"), false);
  assert.equal(invocation.seed.projectRoot, ".");
  assert.equal(invocation.seed.files["app/example.ts"].mutants[0].status, "Survived");
  const independent = await fixture(t);
  assert.match(independent.run().stdout, /Seeding incremental/);
});

test("shared reports remain usable across source and test edits, but not dependency or helper changes", async (t) => {
  const w = await worktrees(t);
  w.first.run();
  await mkdir(path.join(w.second, "app"));
  await mkdir(path.join(w.second, "tests"));
  await writeFile(path.join(w.second, "app/example.ts"), "export const value = false;");
  await writeFile(path.join(w.second, "tests/example.test.ts"), "test('changed', () => {});");
  assert.match(w.runSecond().stdout, /from another worktree/);
  for (const file of ["pnpm-lock.yaml", "tests/helper.ts"]) {
    await writeFile(path.join(w.second, file), "changed");
    const result = w.runSecond();
    assert.match(result.stdout, /forcing a complete/);
    assert.ok((await w.secondInvocation()).args.includes("--force"));
  }
});

test("malformed, mismatched and incomplete shared reports are cache misses", async (t) => {
  const w = await worktrees(t);
  w.first.run();
  const [name] = await readdir(w.cacheDirectory);
  const file = path.join(w.cacheDirectory, name);
  const complete = JSON.parse(await readFile(file, "utf8"));
  const incomplete = structuredClone(complete);
  incomplete.report.files["app/example.ts"].mutants[0].status = "Pending";
  for (const value of ["{", JSON.stringify({ ...complete, context: "different" }), JSON.stringify(incomplete)]) {
    await rm(path.join(w.second, "reports"), { recursive: true, force: true });
    await writeFile(file, value);
    assert.match(w.runSecond().stdout, /Seeding incremental/);
    assert.equal((await w.secondInvocation()).seed.files["app/example.ts"].mutants[0].status, "Killed");
  }
});

test("crashes, incomplete reports and changing inputs cannot replace a shared measurement", async (t) => {
  const w = await worktrees(t);
  w.first.run();
  const [name] = await readdir(w.cacheDirectory);
  const file = path.join(w.cacheDirectory, name);
  const completed = await readFile(file, "utf8");
  for (const variable of ["STUB_CRASH", "STUB_PENDING", "STUB_EMPTY", "STUB_CHANGE_INPUT"]) {
    const result = w.runSecond({ [variable]: "1" });
    assert.equal(result.status, 1);
    assert.equal(await readFile(file, "utf8"), completed);
    await assert.rejects(readFile(path.join(w.second, "reports/stryker-context.txt")), { code: "ENOENT" });
  }
});

test("simultaneous worktrees publish whole reports without mixing their results", async (t) => {
  const w = await worktrees(t);
  const results = await Promise.all([
    runAsync(w.first.directory, { STUB_MARKER: "first" }),
    runAsync(w.second, { STUB_MARKER: "second" }),
  ]);
  for (const result of results) assert.match(result.stderr, /below the required/);
  const entries = await readdir(w.cacheDirectory);
  assert.equal(entries.length, 1);
  const shared = JSON.parse(await readFile(path.join(w.cacheDirectory, entries[0]), "utf8"));
  assert.ok(["first", "second"].includes(shared.report.marker));
  assert.equal(shared.report.projectRoot, ".");
  for (const [directory, marker] of [[w.first.directory, "first"], [w.second, "second"]]) {
    const local = JSON.parse(await readFile(path.join(directory, "reports/stryker-incremental.json"), "utf8"));
    assert.equal(local.marker, marker);
    assert.equal(local.projectRoot, directory);
  }
});

test("shared full reports cannot seed shards or an explicit baseline measurement", async (t) => {
  const w = await worktrees(t);
  for (const directory of [w.first.directory, w.second]) {
    await mkdir(path.join(directory, "app"));
    await writeFile(path.join(directory, "app/example.ts"), "export const a = true; export const b = false;");
  }
  w.first.run();
  const shard = w.runSecond({ MUTATION_SHARD: "1/2" });
  assert.equal(shard.status, 0, shard.stderr);
  assert.match(shard.stdout, /shard 1\/2 without a compatible cache/);
  assert.ok((await w.secondInvocation()).args.includes("--force"));
  w.first.run(["--record-baseline"], { MUTATION_SCORE_THRESHOLD: undefined });
  const invocation = await w.first.invocation();
  assert.equal(invocation.seed, null);
  assert.ok(invocation.args.includes("--force"));
});

test("an unavailable shared cache does not replace score-gate diagnostics", async (t) => {
  const w = await worktrees(t);
  await writeFile(path.join(w.first.directory, ".git/mutation-cache"), "not a directory");
  const result = w.first.run();
  assert.match(result.stderr, /Could not publish shared mutation cache/);
  assert.match(result.stderr, /below the required/);
  assert.equal(result.status, 1);
  assert.match(w.first.run().stdout, /Reusing the latest completed/);
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

test("shards finish below the global threshold and never inherit out-of-scope seed results", async (t) => {
  const f = await fixture(t);
  await mkdir(path.join(f.directory, "app"));
  await writeFile(path.join(f.directory, "app/example.ts"), "export const a = true; export const b = false;");
  const environment = { MUTATION_SHARD: "1/2" };
  assert.equal(f.run([], environment).status, 0);
  assert.equal((await f.invocation()).seed, null);
  assert.ok((await f.invocation()).args.includes("--force"));
  const metadata = JSON.parse(await readFile(path.join(f.directory, "reports/mutation/shard.json")));
  assert.equal(metadata.index, 1);
  assert.equal(metadata.total, 2);
  assert.equal(f.run([], environment).status, 0);
  assert.equal((await f.invocation()).args.includes("--force"), false);
  await writeFile(path.join(f.directory, "app/example.ts"), "export const a = false; export const b = true;");
  assert.equal(f.run([], environment).status, 0);
  assert.equal((await f.invocation()).seed, null);
  assert.ok((await f.invocation()).args.includes("--force"));
});

test("shards cannot overwrite the reviewed baseline", async (t) => {
  const f = await fixture(t);
  assert.match(f.run(["--record-baseline"], { MUTATION_SHARD: "1/2" }).stderr, /without MUTATION_SHARD/);
});
