import { glob, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import config, { mutationSources } from "../stryker.config.mjs";
import { mergeMutationShards, parseMutationShard } from "./mutation-shards.mjs";
import { compareWithBaseline, isBelowMutationScoreThreshold, summarizeMutationReport, validateMutationScoreThreshold } from "./mutation-report.mjs";

const directory = process.argv[2];
const { total } = parseMutationShard(`1/${process.argv[3]}`);
if (!directory) throw new Error("Usage: merge-mutation-shards.mjs <artifact-directory> <total>");
const parts = [];
for await (const file of glob(`${directory}/**/shard.json`)) {
  parts.push({
    metadata: JSON.parse(await readFile(file, "utf8")),
    report: JSON.parse(await readFile(path.join(path.dirname(file), "mutation.json"), "utf8")),
  });
}
const report = mergeMutationShards(parts, mutationSources, total);
report.config = { ...report.config, mutate: config.mutate };
const summary = summarizeMutationReport(report, Math.max(...parts.map(({ metadata }) => metadata.durationMs)));
await mkdir("reports/mutation", { recursive: true });
await writeFile("reports/mutation/mutation.json", JSON.stringify(report));
await writeFile("reports/mutation/summary.json", JSON.stringify(summary, null, 2));
const baseline = JSON.parse(await readFile("mutation-testing/baseline-summary.json", "utf8"));
const threshold = validateMutationScoreThreshold(process.env.MUTATION_SCORE_THRESHOLD ?? "94.8");
console.log(`Merged ${total} shards: ${summary.counts.total} mutants; mutation score ${summary.mutationScore.toFixed(2)}%; baseline ${baseline.mutationScore.toFixed(2)}%.`);
if (isBelowMutationScoreThreshold(summary, threshold)) {
  throw new Error(`Mutation score ${summary.mutationScore.toFixed(2)}% is below the required ${threshold.toFixed(2)}%.`);
}
if (compareWithBaseline(summary, baseline).regressed) {
  throw new Error("Mutation score regressed below the measured baseline.");
}
