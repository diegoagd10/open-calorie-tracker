import { execFileSync } from "node:child_process";
import { chmodSync, existsSync } from "node:fs";
import path from "node:path";

function git(...args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

try {
  const root = git("rev-parse", "--show-toplevel");
  const existing = git("config", "--default", "", "--get", "core.hooksPath");
  if (existing && path.resolve(root, existing) !== path.join(root, ".githooks")) {
    throw new Error(`Existing core.hooksPath is ${existing}. Integrate these hooks with that setup before installing.`);
  }
  for (const name of ["pre-commit", "pre-push"]) {
    const hook = path.join(root, ".githooks", name);
    if (!existsSync(hook)) throw new Error(`Missing hook: ${hook}`);
    const legacyHook = git("rev-parse", "--path-format=absolute", "--git-path", `hooks/${name}`);
    if (!existing && existsSync(legacyHook)) throw new Error(`Existing hook at ${legacyHook}; integrate it before installing.`);
    chmodSync(hook, 0o755);
  }
  // When worktreeConfig is enabled, installation is scoped to this worktree.
  // In a regular clone Git treats --worktree as --local.
  git("config", "--worktree", "core.hooksPath", ".githooks");
  console.log("Installed pre-commit and pre-push hooks. Both run verify:deep and test:deployment; failures block Git and print diagnostics.");
} catch (error) {
  console.error(`Hook installation failed: ${error.message}`);
  process.exitCode = 1;
}
