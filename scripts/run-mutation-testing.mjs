import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";

import {
  compareWithBaseline,
  isBelowMutationScoreThreshold,
  summarizeMutationReport,
  validateMutationScoreThreshold,
} from "./mutation-report.mjs";

const recordBaseline = process.argv.includes("--record-baseline");
const baselineDirectory = "mutation-testing";
const baselineReportPath = `${baselineDirectory}/stryker-incremental.json`;
const baselineSummaryPath = `${baselineDirectory}/baseline-summary.json`;
const reportDirectory = "reports/mutation";
const currentReportPath = `${reportDirectory}/mutation.json`;
const incrementalReportPath = "reports/stryker-incremental.json";
const mutationScoreThreshold =
  process.env.MUTATION_SCORE_THRESHOLD === undefined
    ? undefined
    : validateMutationScoreThreshold(process.env.MUTATION_SCORE_THRESHOLD);

async function exists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function runStryker(args) {
  const command = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const child = spawn(command, ["exec", "stryker", "run", ...args], {
    stdio: "inherit",
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) reject(new Error(`Stryker exited after signal ${signal}`));
      else resolve(code);
    });
  });

  if (exitCode !== 0) {
    throw new Error(`Stryker exited with code ${exitCode}`);
  }
}

await mkdir(reportDirectory, { recursive: true });

if (recordBaseline) {
  await rm(incrementalReportPath, { force: true });
} else {
  if (!(await exists(baselineReportPath)) || !(await exists(baselineSummaryPath))) {
    throw new Error(
      "Mutation baseline is missing. Run `pnpm mutation:baseline` once and commit mutation-testing/.",
    );
  }
  await copyFile(baselineReportPath, incrementalReportPath);
}

const startedAt = performance.now();
await runStryker(recordBaseline ? ["--force"] : []);
const durationMs = performance.now() - startedAt;

const currentReport = JSON.parse(await readFile(currentReportPath, "utf8"));
const currentSummary = summarizeMutationReport(currentReport, durationMs);

if (
  mutationScoreThreshold !== undefined &&
  isBelowMutationScoreThreshold(currentSummary, mutationScoreThreshold)
) {
  throw new Error(
    `Mutation score ${currentSummary.mutationScore.toFixed(2)}% is below the required ${mutationScoreThreshold.toFixed(2)}%.`,
  );
}
if (mutationScoreThreshold !== undefined) {
  console.log(
    `Mutation score ${currentSummary.mutationScore.toFixed(2)}% meets the required ${mutationScoreThreshold.toFixed(2)}%.`,
  );
}

if (recordBaseline) {
  await mkdir(baselineDirectory, { recursive: true });
  const incrementalReport = JSON.parse(
    await readFile(incrementalReportPath, "utf8"),
  );
  // Stryker only needs relative file keys for incremental reuse. Avoid checking
  // the baseline author's workstation path into the portable seed.
  incrementalReport.projectRoot = ".";
  await writeFile(baselineReportPath, JSON.stringify(incrementalReport));
  await writeFile(
    baselineSummaryPath,
    `${JSON.stringify(currentSummary, null, 2)}\n`,
  );
  console.log(
    `Recorded mutation baseline: ${currentSummary.mutationScore.toFixed(2)}% in ${(durationMs / 1000).toFixed(1)}s.`,
  );
} else {
  const baselineSummary = JSON.parse(
    await readFile(baselineSummaryPath, "utf8"),
  );
  const comparison = compareWithBaseline(currentSummary, baselineSummary);
  console.log(
    `Mutation score ${currentSummary.mutationScore.toFixed(2)}%; baseline ${baselineSummary.mutationScore.toFixed(2)}% (${comparison.difference >= 0 ? "+" : ""}${comparison.difference.toFixed(2)} points).`,
  );
  if (comparison.regressed) {
    throw new Error(
      "Mutation score regressed below the measured baseline. Improve the tests or explicitly review and record a new baseline.",
    );
  }
}
