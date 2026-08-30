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

export function evaluateCodeQlResults(documents) {
  if (documents.length === 0) {
    return ["CodeQL produced no SARIF documents."];
  }

  const errors = [];
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
      errors.push(...(run.results ?? []).map(findingDescription));
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

  const errors = evaluateCodeQlResults(await loadSarifDocuments(directory));
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
