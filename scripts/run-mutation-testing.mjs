import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
  access,
  copyFile,
  glob,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
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
const incrementalContextPath = "reports/stryker-context.txt";
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

async function incrementalContext() {
  // Stryker compares mutated source and test cases itself. Invalidate reuse for
  // inputs outside that comparison, including fixtures, migrations and wiring.
  const files = [];
  for await (const file of glob([
    "*.{json,yaml,js,mjs,ts}",
    "scripts/**",
    "drizzle/**",
    "tests/**",
    "public/**",
    "app/**/*.{css,json,svg}",
    "app/**/runtime.server.ts",
    "server/**",
    "mutation-testing/**",
  ], {
    exclude: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "tests/browser/**"],
  })) {
    if ((await stat(file)).isFile()) files.push(file);
  }
  const hash = createHash("sha256").update(
    JSON.stringify([process.version, process.platform, process.arch]),
  );
  for (const file of files.sort()) {
    hash.update(JSON.stringify([file, await readFile(file, "utf8")]));
  }
  return hash.digest("hex");
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
const context = await incrementalContext();
const hasCachedContext = await exists(incrementalContextPath);
const contextMatches = hasCachedContext &&
  (await readFile(incrementalContextPath, "utf8")) === context;
let force = recordBaseline;

if (recordBaseline) {
  await rm(incrementalReportPath, { force: true });
} else {
  if (!(await exists(baselineReportPath)) || !(await exists(baselineSummaryPath))) {
    throw new Error(
      "Mutation baseline is missing. Run `pnpm mutation:baseline` once and commit mutation-testing/.",
    );
  }
  if (contextMatches && await exists(incrementalReportPath)) {
    console.log("Reusing the latest completed incremental mutation report.");
  } else if (hasCachedContext || await exists(incrementalReportPath)) {
    // A dependency/helper/config change may affect unchanged source and tests.
    // Neither the cached report nor the older versioned seed is safe to reuse.
    force = true;
    // Keep the untrusted report until Stryker replaces it. If Stryker crashes,
    // a report without its completion marker must also force the next run.
    console.log("Mutation inputs changed; forcing a complete measurement.");
  } else {
    await copyFile(baselineReportPath, incrementalReportPath);
    console.log("Seeding incremental mutation testing from the versioned report.");
  }
}

// Only publish cache eligibility after Stryker produces a complete report.
await rm(incrementalContextPath, { force: true });
await rm(currentReportPath, { force: true });
const startedAt = performance.now();
await runStryker(force ? ["--force"] : []);
const durationMs = performance.now() - startedAt;

const currentReport = JSON.parse(await readFile(currentReportPath, "utf8"));
const currentSummary = summarizeMutationReport(currentReport, durationMs);
await writeFile(incrementalContextPath, context);

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
