import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const allowlistUrl = new URL(
  "../.github/dependency-audit-allowlist.json",
  import.meta.url,
);

function findingSignature(finding) {
  return JSON.stringify({
    bundled: finding.bundled,
    dev: finding.dev,
    optional: finding.optional,
    path: finding.path,
    version: finding.version,
  });
}

function actualFindings(advisory) {
  if (!Array.isArray(advisory.findings)) return [];

  return advisory.findings.flatMap((finding) => {
    if (!Array.isArray(finding.paths)) return [];

    return finding.paths.map((path) => ({
      bundled: finding.bundled,
      dev: finding.dev,
      optional: finding.optional,
      path,
      version: finding.version,
    }));
  });
}

function compareFindings(actual, expected) {
  const actualSignatures = actual.map(findingSignature).sort();
  const expectedSignatures = expected.map(findingSignature).sort();
  return JSON.stringify(actualSignatures) === JSON.stringify(expectedSignatures);
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function validateAllowedAdvisory(advisory) {
  const requiredStrings = [
    "githubAdvisoryId",
    "moduleName",
    "reason",
    "removeWhen",
    "upstream",
  ];
  const missingString = requiredStrings.find(
    (field) =>
      typeof advisory[field] !== "string" || advisory[field].length === 0,
  );

  requireCondition(
    !missingString,
    `Allowlisted advisory is missing ${missingString}.`,
  );
  requireCondition(
    Number.isInteger(advisory.pnpmAdvisoryId),
    "Allowlisted advisory is missing pnpmAdvisoryId.",
  );
  requireCondition(
    Array.isArray(advisory.findings) && advisory.findings.length > 0,
    `Allowlisted advisory ${advisory.githubAdvisoryId} has no findings.`,
  );
}

function validateAllowlist(allowlist) {
  requireCondition(
    allowlist && Array.isArray(allowlist.advisories),
    "The dependency audit allowlist must contain an advisories array.",
  );

  allowlist.advisories.forEach(validateAllowedAdvisory);
  const advisoryIds = allowlist.advisories.map(
    (advisory) => advisory.githubAdvisoryId,
  );
  requireCondition(
    new Set(advisoryIds).size === advisoryIds.length,
    "The dependency audit allowlist contains a duplicate advisory.",
  );
}

export function evaluateAudit(auditReport, allowlist) {
  validateAllowlist(allowlist);

  if (
    !auditReport ||
    typeof auditReport.advisories !== "object" ||
    auditReport.advisories === null ||
    Array.isArray(auditReport.advisories)
  ) {
    throw new Error("pnpm audit returned an unrecognized report.");
  }

  const expectedById = new Map(
    allowlist.advisories.map((advisory) => [
      advisory.githubAdvisoryId,
      advisory,
    ]),
  );
  const observedIds = new Set();
  const errors = [];

  for (const advisory of Object.values(auditReport.advisories)) {
    const advisoryId = advisory.github_advisory_id;
    const expected = expectedById.get(advisoryId);

    if (!expected) {
      errors.push(
        `Unexpected advisory ${advisoryId ?? advisory.id ?? "with no identifier"} (${advisory.module_name ?? "unknown module"}).`,
      );
      continue;
    }

    observedIds.add(advisoryId);

    if (
      advisory.id !== expected.pnpmAdvisoryId ||
      advisory.module_name !== expected.moduleName
    ) {
      errors.push(
        `${advisoryId} no longer matches the allowlisted pnpm advisory ID and module.`,
      );
    }

    if (!compareFindings(actualFindings(advisory), expected.findings)) {
      errors.push(
        `${advisoryId} no longer matches the exact allowlisted version and dependency path.`,
      );
    }
  }

  for (const advisoryId of expectedById.keys()) {
    if (!observedIds.has(advisoryId)) {
      errors.push(
        `Allowlisted advisory ${advisoryId} is no longer present; remove its stale exception.`,
      );
    }
  }

  return errors;
}

async function main() {
  const allowlist = JSON.parse(await readFile(allowlistUrl, "utf8"));
  const audit = spawnSync("pnpm", ["audit", "--json"], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });

  if (audit.error) throw audit.error;
  if (audit.stderr) process.stderr.write(audit.stderr);

  let auditReport;
  try {
    auditReport = JSON.parse(audit.stdout);
  } catch {
    throw new Error(
      `pnpm audit did not return JSON (exit ${audit.status ?? "unknown"}).`,
    );
  }

  const errors = evaluateAudit(auditReport, allowlist);
  if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  if (audit.status !== 0 && audit.status !== 1) {
    throw new Error(`pnpm audit failed with exit code ${audit.status}.`);
  }

  const accepted = allowlist.advisories.map(
    (advisory) => advisory.githubAdvisoryId,
  );
  const summary =
    accepted.length === 0
      ? "no exceptions"
      : `documented exception: ${accepted.join(", ")}`;
  console.log(`Full dependency audit passed with ${summary}.`);
}

const invokedPath = process.argv[1] && pathToFileURL(process.argv[1]).href;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
