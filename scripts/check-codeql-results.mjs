import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

function findingDescription(result) {
  const location = result.locations?.[0]?.physicalLocation;
  const file = location?.artifactLocation?.uri ?? "unknown file";
  const line = location?.region?.startLine ?? "unknown line";
  const rule = result.ruleId ?? "unknown rule";
  const message = result.message?.text ?? "No message provided";
  return `${rule} at ${file}:${line}: ${message}`;
}

function findingKey({ path: file, primaryLocationLineHash, ruleId }) {
  return JSON.stringify([ruleId, file, primaryLocationLineHash]);
}

function findingIdentity(result) {
  return {
    path:
      result.locations?.[0]?.physicalLocation?.artifactLocation?.uri ??
      "unknown file",
    primaryLocationLineHash:
      result.partialFingerprints?.primaryLocationLineHash,
    ruleId: result.ruleId ?? "unknown rule",
  };
}

export function evaluateCodeQlResults(documents, reviewedFindings = []) {
  if (documents.length === 0) {
    return ["CodeQL produced no SARIF documents."];
  }

  const errors = [];
  const matchedReviewedFindings = new Set();
  const reviewedByKey = new Map(
    reviewedFindings.map((finding) => [findingKey(finding), finding]),
  );
  for (const document of documents) {
    if (!Array.isArray(document.runs) || document.runs.length === 0) {
      errors.push("CodeQL produced an invalid SARIF document with no runs.");
      continue;
    }

    for (const run of document.runs) {
      const failedInvocation = run.invocations?.find(
        (invocation) => invocation.executionSuccessful === false,
      );
      if (failedInvocation) {
        errors.push("CodeQL reported an unsuccessful analysis invocation.");
      }
      for (const result of run.results ?? []) {
        const key = findingKey(findingIdentity(result));
        if (reviewedByKey.has(key)) {
          matchedReviewedFindings.add(key);
        } else {
          errors.push(findingDescription(result));
        }
      }
    }
  }

  for (const [key, finding] of reviewedByKey) {
    if (!matchedReviewedFindings.has(key)) {
      errors.push(
        `Reviewed CodeQL finding no longer matches: ${finding.ruleId} at ${finding.path} (${finding.primaryLocationLineHash}).`,
      );
    }
  }

  return errors;
}

async function loadSarifDocuments(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const sarifFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sarif"))
    .map((entry) => path.join(directory, entry.name));

  return await Promise.all(
    sarifFiles.map(async (file) => JSON.parse(await readFile(file, "utf8"))),
  );
}

async function main() {
  const directory = process.argv[2];
  if (!directory) throw new Error("Pass the CodeQL SARIF directory to inspect.");

  const allowlist = JSON.parse(
    await readFile(".github/codeql/finding-allowlist.json", "utf8"),
  );
  const errors = evaluateCodeQlResults(
    await loadSarifDocuments(directory),
    allowlist.findings,
  );
  if (errors.length > 0) {
    for (const error of errors) console.error(`- ${error}`);
    process.exitCode = 1;
    return;
  }

  console.log("CodeQL completed successfully with no security findings.");
}

const invokedPath = process.argv[1] && pathToFileURL(process.argv[1]).href;
if (invokedPath === import.meta.url) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
