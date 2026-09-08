import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { summarizeMutationReport } from "./mutation-report.mjs";

function cachePath(context) {
  try {
    const commonDirectory = execFileSync(
      "git", ["rev-parse", "--path-format=absolute", "--git-common-dir"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    ).trim();
    return path.join(commonDirectory, "mutation-cache", "v1", `${context}.json`);
  } catch {
    // Source archives and test fixtures still support local incremental runs.
    return undefined;
  }
}

export function assertCompleteMutationReport(report) {
  const summary = summarizeMutationReport(report, 0);
  if (summary.counts.Pending || summary.counts.total === 0) {
    throw new Error("Mutation report is incomplete or empty");
  }
}

export async function restoreSharedMutationReport(context, target) {
  const source = cachePath(context);
  if (!source) return false;
  let report;
  try {
    const cached = JSON.parse(await readFile(source, "utf8"));
    if (cached.version !== 1 || cached.context !== context) return false;
    report = cached.report;
    assertCompleteMutationReport(report);
    // Stryker needs test source and IDs to compare tests across checkouts.
    if (!report.testFiles || !Object.values(report.files).every((file) => typeof file.source === "string")) return false;
  } catch {
    // Missing, interrupted or malformed cache entries are cache misses.
    return false;
  }
  await writeFile(target, JSON.stringify(report));
  return true;
}

export async function publishSharedMutationReport(context, report) {
  assertCompleteMutationReport(report);
  const target = cachePath(context);
  if (!target) return;
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(temporary, JSON.stringify({
      version: 1, context, report: { ...report, projectRoot: "." },
    }), { flag: "wx" });
    // Readers see one complete report even when several worktrees publish at
    // once. Never share Stryker's live output files or merge their test IDs.
    await rename(temporary, target);
  } catch (error) {
    console.warn(`Could not publish shared mutation cache: ${error.message}`);
  } finally {
    await rm(temporary, { force: true }).catch(() => {});
  }
}
