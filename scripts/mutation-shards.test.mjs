import assert from "node:assert/strict";
import test from "node:test";
import { mergeMutationShards, mutationSourceHash, ownsMutant, parseMutationShard, planMutationShards } from "./mutation-shards.mjs";
import { summarizeMutationReport } from "./mutation-report.mjs";

const sources = {
  "app/a.ts": "export function a() {\n  return true;\n}\nexport const b = false;\n",
  "app/b.tsx": "export function B() { return <div>Hello</div>; }\n",
};
function reportLocation(unit) {
  const convert = (p) => ({ ...p, column: p.column + 1 });
  return { start: convert(unit.start), end: convert(unit.end) };
}
function partsFor(total = 2) {
  return planMutationShards(sources, total).map((shard) => ({
    metadata: { index: shard.index, total, sourceHash: mutationSourceHash(sources), mutantCount: shard.units.length, durationMs: 1 },
    report: { files: Object.fromEntries(shard.units.map((unit) => [unit.file, {
      source: sources[unit.file],
      mutants: shard.units.filter((other) => other.file === unit.file).map((other, i) => ({
        id: String(i), location: reportLocation(other), mutatorName: "BlockStatement", replacement: "{}", status: "Killed", killedBy: ["0"],
      })),
    }])) },
  }));
}

test("partitions every whole statement exactly once, including multiline blocks and TSX", () => {
  const plan = planMutationShards(sources, 2);
  const units = plan.flatMap((s) => s.units);
  assert.equal(units.length, 3);
  for (const unit of units) {
    assert.equal(plan.filter((s) => ownsMutant(s, unit.file, reportLocation(unit))).length, 1);
  }
  assert.ok(units.some((unit) => unit.start.line === 1 && unit.end.line === 3));
  assert.deepEqual(plan, planMutationShards(Object.fromEntries(Object.entries(sources).reverse()), 2));
});

test("rejects malformed shard coordinates", () => {
  assert.equal(parseMutationShard(undefined), undefined);
  assert.deepEqual(parseMutationShard("2/8"), { index: 2, total: 8 });
  for (const value of ["0/8", "9/8", "1/0", "1/33", "abc", "1/2extra"]) assert.throws(() => parseMutationShard(value));
});

test("merges the full score and namespaces shard-local IDs", () => {
  const parts = partsFor();
  const merged = mergeMutationShards(parts, sources, 2);
  assert.equal(summarizeMutationReport(merged, 0).counts.Killed, 3);
  const mutants = Object.values(merged.files).flatMap((file) => file.mutants);
  assert.equal(new Set(mutants.map((m) => m.id)).size, 3);
  assert.ok(mutants.every((m) => m.killedBy[0].includes(":")));
});

test("rejects missing, duplicate, stale, unfinished, and wrongly assigned reports", () => {
  const parts = partsFor();
  assert.throws(() => mergeMutationShards(parts.slice(1), sources, 2), /Missing/);
  assert.throws(() => mergeMutationShards([parts[0], parts[0]], sources, 2), /duplicate/);
  const stale = structuredClone(parts);
  stale[0].metadata.sourceHash = "stale";
  assert.throws(() => mergeMutationShards(stale, sources, 2), /mismatch/);
  const unfinished = structuredClone(parts);
  Object.values(unfinished[0].report.files)[0].mutants[0].status = "Pending";
  assert.throws(() => mergeMutationShards(unfinished, sources, 2), /Incomplete/);
  const truncated = structuredClone(parts);
  truncated[0].report.files = {};
  assert.throws(() => mergeMutationShards(truncated, sources, 2), /truncated/);
  const wrong = structuredClone(parts);
  [wrong[0].metadata.index, wrong[1].metadata.index] = [2, 1];
  assert.throws(() => mergeMutationShards(wrong, sources, 2), /outside shard/);
});

test("the combined CLI enforces both gates and accepts a passing aggregate", async (t) => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const path = await import("node:path");
  const { spawnSync } = await import("node:child_process");
  const directory = await mkdtemp(path.join(tmpdir(), "mutation-merge-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const [file, source] of Object.entries(sources)) {
    await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
    await writeFile(path.join(directory, file), source);
  }
  const parts = partsFor();
  Object.values(parts[0].report.files)[0].mutants[0].status = "Survived";
  for (const part of parts) {
    const d = path.join(directory, `artifacts/${part.metadata.index}`);
    await mkdir(d, { recursive: true });
    await writeFile(path.join(d, "shard.json"), JSON.stringify(part.metadata));
    await writeFile(path.join(d, "mutation.json"), JSON.stringify(part.report));
  }
  await mkdir(path.join(directory, "mutation-testing"));
  const baselineFile = path.join(directory, "mutation-testing/baseline-summary.json");
  const run = (threshold) => spawnSync(process.execPath, [path.resolve("scripts/merge-mutation-shards.mjs"), "artifacts", "2"], {
    cwd: directory, encoding: "utf8", env: { ...process.env, MUTATION_SHARD: undefined, MUTATION_SCORE_THRESHOLD: threshold },
  });
  await writeFile(baselineFile, JSON.stringify({ mutationScore: 100, counts: { detected: 3, valid: 3 } }));
  assert.match(run("94.8").stderr, /below the required/);
  assert.match(run("60").stderr, /regressed below/);
  await writeFile(baselineFile, JSON.stringify({ mutationScore: 50, counts: { detected: 1, valid: 2 } }));
  assert.equal(run("60").status, 0);
});

test("real Stryker instrumentation preserves directive state across shard boundaries", async () => {
  const { createRequire } = await import("node:module");
  const { pathToFileURL } = await import("node:url");
  // Exercise the exact instrumenter supplied by the pinned Stryker engine.
  const require = createRequire(import.meta.url);
  const coreRequire = createRequire(require.resolve("@stryker-mutator/core"));
  const { Instrumenter } = await import(pathToFileURL(coreRequire.resolve("@stryker-mutator/instrumenter")));
  const fixtureSource = {
    "example.ts": `function format(value, unit) {
  // Stryker disable ObjectLiteral,ConditionalExpression: reviewed formatting equivalents
  return { value: unit === "g" ? value / 1000 : value };
  // Stryker restore ObjectLiteral,ConditionalExpression
}
export function a(value) { return { value: value ? 1 : 2 }; }
export function b(value) { return { value: value ? 3 : 4 }; }
`,
  };
  const logger = { debug() {}, info() {}, warn() {}, isDebugEnabled() { return false; } };
  const options = { plugins: null, ignorers: [], excludedMutations: [] };
  const instrument = async (mutate) => {
    const result = await new Instrumenter(logger).instrument([{ name: "example.ts", content: fixtureSource["example.ts"], mutate }], options);
    return result.mutants.map((m) => [JSON.stringify([m.fileName, m.location, m.mutatorName, m.replacement]), m.statusReason]);
  };
  const full = new Map(await instrument(true));
  const collect = async (includeDirectiveRanges) => {
    const entries = [];
    for (const shard of planMutationShards(fixtureSource, 3)) {
      const ranges = shard.mutate.map((pattern) => {
        const [, , line, column, endLine, endColumn] = /^(.*):(\d+):(\d+)-(\d+):(\d+)$/.exec(pattern);
        return { start: { line: Number(line) - 1, column: Number(column) }, end: { line: Number(endLine) - 1, column: Number(endColumn) } };
      }).filter((range) => includeDirectiveRanges || JSON.stringify(range.start) !== JSON.stringify(range.end));
      entries.push(...await instrument(ranges));
    }
    assert.equal(new Map(entries).size, entries.length, "each mutant must be generated exactly once");
    return new Map(entries);
  };
  assert.notDeepEqual(await collect(false), full, "fixture must expose skipped directive traversal");
  assert.deepEqual(await collect(true), full);
});
