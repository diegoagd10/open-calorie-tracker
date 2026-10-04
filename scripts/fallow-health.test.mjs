import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const fallowBinary = path.join(repositoryRoot, "node_modules", ".bin", "fallow");
const coveragePath = path.join(
  repositoryRoot,
  "coverage",
  "coverage-final.json",
);
const coverageExclusions = new Set([
  "app/catalog/test-fixture.server.ts",
  "server/playwright-https.js",
]);

async function listRuntimeSourceFiles(directory) {
  const entries = await readdir(path.join(repositoryRoot, directory), {
    withFileTypes: true,
  });
  const nestedFiles = await Promise.all(
    entries.map(async (entry) => {
      const relativePath = path.join(directory, entry.name);
      return entry.isDirectory()
        ? listRuntimeSourceFiles(relativePath)
        : [relativePath];
    }),
  );

  return nestedFiles.flat().filter(
    (file) => /\.(?:js|ts|tsx)$/.test(file) && !file.endsWith(".d.ts"),
  );
}

function runFallow(...arguments_) {
  const result = spawnSync(
    fallowBinary,
    [
      "health",
      "--format",
      "json",
      "--quiet",
      "--no-cache",
      "--coverage",
      coveragePath,
      ...arguments_,
    ],
    { cwd: repositoryRoot, encoding: "utf8" },
  );

  assert.equal(
    result.error,
    undefined,
    `Fallow could not run: ${result.error?.message ?? result.stderr}`,
  );
  return result;
}

function runHealthGate(...arguments_) {
  const result = spawnSync(
    "pnpm",
    ["--silent", "health:check", ...arguments_],
    { cwd: repositoryRoot, encoding: "utf8" },
  );

  assert.equal(
    result.error,
    undefined,
    `the health gate could not run: ${result.error?.message ?? result.stderr}`,
  );
  return result;
}

function functionHits(coverage, fileSuffix, functionName) {
  const fileCoverage = Object.entries(coverage).find(([file]) =>
    file.endsWith(fileSuffix),
  )?.[1];
  assert.ok(fileCoverage, `coverage is missing ${fileSuffix}`);
  const functionId = Object.entries(fileCoverage.fnMap).find(
    ([, metadata]) => metadata.name === functionName,
  )?.[0];
  assert.ok(functionId, `coverage is missing ${functionName} in ${fileSuffix}`);
  return fileCoverage.f[functionId];
}

test("Fallow health consumes Vitest coverage and preserves gating exit codes", async (t) => {
  const regressionPath = path.join(
    repositoryRoot,
    "app",
    "health-regression.fixture.ts",
  );
  t.after(() => rm(regressionPath, { force: true }));

  const coverage = JSON.parse(await readFile(coveragePath, "utf8"));
  const coveredPaths = Object.keys(coverage)
    .map((file) => path.relative(repositoryRoot, file))
    .sort();
  const productionPaths = [
    "server.js",
    ...(await listRuntimeSourceFiles("app")),
    ...(await listRuntimeSourceFiles("server")),
  ]
    .filter((file) => !coverageExclusions.has(file))
    .sort();

  assert.ok(coveredPaths.length > 0, "Vitest did not report any source files");
  assert.deepEqual(coveredPaths, productionPaths);
  assert.ok(
    functionHits(
      coverage,
      "/server/startup-configuration.js",
      "validateServerConfiguration",
    ) > 0,
  );
  assert.ok(functionHits(coverage, "/server/entry-policy.ts", "entryPolicy") > 0);
  assert.ok(functionHits(coverage, "/app/auth/http.server.ts", "parseCookies") > 0);

  const currentGate = runHealthGate("--format", "json", "--quiet", "--no-cache");
  assert.equal(
    currentGate.status,
    0,
    `the current health baseline should pass:\n${currentGate.stderr}\n${currentGate.stdout}`,
  );
  const currentReport = JSON.parse(currentGate.stdout);
  assert.equal(currentReport.summary.functions_above_threshold, 0);
  assert.equal(currentReport.findings.length, 0);
  assert.deepEqual(currentReport.summary.baseline_staleness, {
    baseline_entries: 0,
    change_scoped: false,
    matched_entries: 0,
    moved_entries: 0,
    stale: false,
    stale_entries: 0,
  });

  await writeFile(
    regressionPath,
    [
      "export function untestedHealthRegression(value: number) {",
      "  if (value === 1) return 1;",
      "  if (value === 2) return 2;",
      "  if (value === 3) return 3;",
      "  if (value === 4) return 4;",
      "  if (value === 5) return 5;",
      "  if (value === 6) return 6;",
      "  return 0;",
      "}",
      "",
    ].join("\n"),
  );
  const regressionGate = runHealthGate(
    "--format",
    "json",
    "--quiet",
    "--no-cache",
  );
  assert.equal(
    regressionGate.status,
    1,
    `a new untested complex function should fail:\n${regressionGate.stderr}\n${regressionGate.stdout}`,
  );
  const regressionReport = JSON.parse(regressionGate.stdout);
  const measuredRegression = regressionReport.findings.find(
    (finding) =>
      finding.path === "app/health-regression.fixture.ts" &&
      finding.name === "untestedHealthRegression",
  );
  assert.ok(measuredRegression, "the gate did not identify the new untested function");
  assert.equal(measuredRegression.cyclomatic, 7);
  assert.equal(measuredRegression.crap, 56);
  await rm(regressionPath, { force: true });

  const reportOnly = runFallow("--report-only");
  assert.equal(
    reportOnly.status,
    0,
    `report-only health analysis should not fail automation:\n${reportOnly.stderr}\n${reportOnly.stdout}`,
  );

  const report = JSON.parse(reportOnly.stdout);
  assert.equal(report.summary.coverage_model, "istanbul");
  assert.ok(report.summary.istanbul_matched > 0);
  assert.equal(
    report.findings.find(
      (finding) =>
        finding.path.startsWith("app/routes/") || finding.path.endsWith(".tsx"),
    ),
    undefined,
    "route and UI functions should not participate in the health gate",
  );

});
