import { createHash } from "node:crypto";
import { glob, readFile } from "node:fs/promises";
import { matchesGlob } from "node:path";
import ts from "typescript";

export function parseMutationShard(value) {
  if (value === undefined) return undefined;
  const match = /^([1-9]\d*)\/([1-9]\d*)$/.exec(value);
  if (!match || Number(match[1]) > Number(match[2]) || Number(match[2]) > 32) {
    throw new Error("MUTATION_SHARD must be index/total with 1 <= index <= total <= 32");
  }
  return { index: Number(match[1]), total: Number(match[2]) };
}

export function readMutationShard() {
  return parseMutationShard(process.env.MUTATION_SHARD);
}

export async function readMutationSources(patterns) {
  const files = new Set();
  for (const pattern of patterns) {
    if (pattern.startsWith("!")) {
      for (const file of files) {
        if (matchesGlob(file, pattern.slice(1))) files.delete(file);
      }
    } else {
      for await (const file of glob(pattern)) files.add(file);
    }
  }
  const sources = {};
  for (const file of [...files].sort()) sources[file] = await readFile(file, "utf8");
  return sources;
}

export function mutationSourceHash(sources) {
  return createHash("sha256").update(JSON.stringify(
    Object.entries(sources).sort(([a], [b]) => a.localeCompare(b)),
  )).digest("hex");
}

function nodeWeight(node) {
  let weight = 1;
  ts.forEachChild(node, (child) => { weight += nodeWeight(child); });
  return weight;
}

// A top-level statement owns every nested mutation, including mutations spanning
// many lines. Cutting at arbitrary line numbers would drop crossing mutations.
export function planMutationShards(sources, total) {
  parseMutationShard(`1/${total}`);
  const units = [];
  const directiveRanges = [];
  for (const [file, source] of Object.entries(sources).sort(([a], [b]) => a.localeCompare(b))) {
    // Stryker reads directives while walking the tree, even outside selected
    // ranges. Visit their containing blocks in every shard so skipping a
    // statement cannot change a later statement's disable/restore state.
    // Zero-width comment ranges select no executable nodes or extra mutants.
    source.split("\n").forEach((line, i) => {
      if (/\bStryker (?:disable|restore)\b/.test(line)) {
        directiveRanges.push(`${file}:${i + 1}:0-${i + 1}:0`);
      }
    });
    const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    for (const statement of parsed.statements) {
      const position = (offset) => {
        const value = parsed.getLineAndCharacterOfPosition(offset);
        return { line: value.line + 1, column: value.character };
      };
      const start = position(statement.getFullStart());
      const end = position(statement.end);
      units.push({ file, start, end, weight: nodeWeight(statement) });
    }
  }
  const shards = Array.from({ length: total }, (_, i) => ({ index: i + 1, weight: 0, units: [] }));
  units.sort((a, b) => b.weight - a.weight || a.file.localeCompare(b.file) || a.start.line - b.start.line || a.start.column - b.start.column);
  for (const unit of units) {
    const shard = shards.reduce((a, b) => a.weight <= b.weight ? a : b);
    shard.units.push(unit);
    shard.weight += unit.weight;
  }
  return shards.map((shard) => ({
    ...shard,
    mutate: [
      ...shard.units.map(({ file, start, end }) => `${file}:${start.line}:${start.column}-${end.line}:${end.column}`),
      ...directiveRanges,
    ],
  }));
}

function positionBefore(a, b) {
  return a.line < b.line || (a.line === b.line && a.column <= b.column);
}

export function ownsMutant(shard, file, location) {
  // Mutation reports use one-based columns; Stryker's CLI ranges and the
  // TypeScript parser use zero-based columns.
  const start = { ...location.start, column: location.start.column - 1 };
  const end = { ...location.end, column: location.end.column - 1 };
  return shard.units.some((unit) => unit.file === file &&
    positionBefore(unit.start, start) && positionBefore(end, unit.end));
}

export function mergeMutationShards(parts, sources, total) {
  const plan = planMutationShards(sources, total);
  const sourceHash = mutationSourceHash(sources);
  const seenShards = new Set();
  const seenMutants = new Set();
  const files = {};
  for (const { metadata, report } of parts) {
    const { index } = metadata;
    if (metadata.total !== total || !Number.isInteger(index) || index < 1 || index > total || seenShards.has(index)) {
      throw new Error("Missing, duplicate, or invalid mutation shard");
    }
    if (metadata.sourceHash !== sourceHash) throw new Error("Mutation shard source mismatch");
    const mutantCount = Object.values(report.files).reduce((sum, file) => sum + file.mutants.length, 0);
    if (mutantCount === 0 || mutantCount !== metadata.mutantCount) {
      throw new Error("Empty or truncated mutation shard");
    }
    seenShards.add(index);
    for (const [file, result] of Object.entries(report.files)) {
      if (result.source !== sources[file]) throw new Error(`Mutation shard source mismatch: ${file}`);
      files[file] ??= { ...result, mutants: [] };
      for (const mutant of result.mutants) {
        if (!ownsMutant(plan[index - 1], file, mutant.location)) {
          throw new Error(`Mutant is outside shard ${index}: ${file}`);
        }
        const identity = JSON.stringify([file, mutant.location, mutant.mutatorName, mutant.replacement]);
        if (seenMutants.has(identity)) throw new Error(`Duplicate mutant: ${file}`);
        if (mutant.status === "Pending") throw new Error(`Incomplete mutation shard: ${file}`);
        seenMutants.add(identity);
        // Test IDs are local to each Stryker run. Namespace them for the merged
        // report, just as mutant IDs must be unique across shards.
        const remapTests = (ids) => ids?.map((id) => `${index}:${id}`);
        files[file].mutants.push({ ...mutant, id: `${index}:${mutant.id}`, coveredBy: remapTests(mutant.coveredBy), killedBy: remapTests(mutant.killedBy) });
      }
    }
  }
  if (seenShards.size !== total) throw new Error(`Missing mutation shards: expected ${total}, got ${seenShards.size}`);
  const testFiles = {};
  for (const { metadata, report } of parts) {
    for (const [file, result] of Object.entries(report.testFiles ?? {})) {
      testFiles[file] ??= { ...result, tests: [] };
      testFiles[file].tests.push(...result.tests.map((test) => ({ ...test, id: `${metadata.index}:${test.id}` })));
    }
  }
  return { ...parts[0].report, files, testFiles, projectRoot: "." };
}
