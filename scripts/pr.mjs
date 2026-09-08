import { execFileSync, spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from "node:fs";
import path from "node:path";

const checks = ["verify:deep", "test:deployment"];
const pnpm = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
let root;

function git(...args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function options() {
  const [mode, ...args] = process.argv.slice(2);
  if (!["check", "create", "pre-commit", "pre-push"].includes(mode)) throw new Error("Use pnpm pr:check or pnpm pr:create.");
  let base = git("config", "--default", "main", "--get", "pr.base");
  if (mode === "pre-push") return { mode, base, forwarded: args };
  const forwarded = [];
  const values = new Set(["--title", "--body", "--body-file", "--reviewer", "--assignee", "--label", "--milestone", "--project"]);
  const flags = new Set(["--draft", "--fill", "--fill-first", "--fill-verbose"]);
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--base" || (mode === "create" && values.has(arg))) {
      const value = args[++index];
      if (!value || value.startsWith("-")) throw new Error(`Missing value for ${arg}.`);
      if (arg === "--base") base = value;
      else forwarded.push(arg, value);
    } else if (mode === "create" && flags.has(arg)) {
      forwarded.push(arg);
    } else {
      throw new Error(`Unsupported argument: ${arg}. Head and repository are fixed by the verification record.`);
    }
  }
  git("check-ref-format", `refs/heads/${base}`);
  return { mode, base, forwarded };
}

function checkout(staged = false) {
  const branch = git("symbolic-ref", "--quiet", "--short", "HEAD");
  if (staged) {
    if (git("diff", "--name-only", "--ignore-submodules=none") || git("ls-files", "--others", "--exclude-standard")) {
      throw new Error("Stage all intended changes and remove unrelated untracked files before committing. Partial staging is not supported by the verification hook.");
    }
  } else if (git("status", "--porcelain", "--untracked-files=all", "--ignore-submodules=none")) {
    throw new Error("Commit or remove all staged, unstaged, and untracked changes before checking or creating a PR.");
  }
  return staged
    ? { branch, parentCommit: git("rev-parse", "HEAD"), tree: git("write-tree") }
    : { branch, commit: git("rev-parse", "HEAD") };
}

function identity(base, staged = false) {
  const current = checkout(staged);
  if (current.branch === base || ["main", "master"].includes(current.branch)) {
    throw new Error("Switch to a feature branch before checking or creating a PR.");
  }
  const remote = git("remote", "get-url", "origin");
  if (git("remote", "get-url", "--push", "origin") !== remote) {
    throw new Error("origin must use the same fetch and push repository.");
  }
  git("fetch", "--no-tags", "origin", `refs/heads/${base}`);
  const baseCommit = git("rev-parse", "FETCH_HEAD");
  if (!staged && Number(git("rev-list", "--count", `${baseCommit}..${current.commit}`)) === 0) {
    throw new Error("The branch has no commits to propose against the base.");
  }
  return { ...current, remote, base, baseCommit };
}

function assertCheckout(expected) {
  const current = checkout(Boolean(expected.tree));
  if (Object.entries(current).some(([key, value]) => expected[key] !== value) ||
      git("remote", "get-url", "origin") !== expected.remote ||
      git("remote", "get-url", "--push", "origin") !== expected.remote) {
    throw new Error("Branch, commit, or origin changed. Run pnpm pr:check again.");
  }
}

function save(directory, report) {
  const target = path.join(directory, "summary.json");
  writeFileSync(`${target}.tmp`, `${JSON.stringify(report, null, 2)}\n`);
  renameSync(`${target}.tmp`, target);
}

async function run(command, args, { log, env = process.env } = {}) {
  const fd = log ? openSync(log, "w") : undefined;
  const child = spawn(command, args, { cwd: root, env, stdio: log ? ["ignore", "pipe", "pipe"] : "inherit" });
  let interrupted;
  const onSignal = (signal) => { interrupted = signal; child.kill(signal); };
  const onInt = () => onSignal("SIGINT");
  const onTerm = () => onSignal("SIGTERM");
  process.on("SIGINT", onInt);
  process.on("SIGTERM", onTerm);
  if (log) {
    child.stdout.on("data", (chunk) => { writeSync(fd, chunk); process.stdout.write(chunk); });
    child.stderr.on("data", (chunk) => { writeSync(fd, chunk); process.stderr.write(chunk); });
  }
  try {
    return await new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code, signal) => resolve({ exitCode: code, signal: interrupted ?? signal }));
    });
  } finally {
    process.off("SIGINT", onInt);
    process.off("SIGTERM", onTerm);
    if (fd !== undefined) closeSync(fd);
  }
}

async function check(expected, directory) {
  const report = {
    version: 1, ...expected, status: "running", startedAt: new Date().toISOString(),
    node: process.version, checks: checks.map((command) => ({ command, status: "pending" })),
  };
  // Replace any previous pass before starting; interrupted runs cannot reuse it.
  save(directory, report);
  console.log(`Checking ${expected.branch} at ${expected.commit ?? `staged tree ${expected.tree}`} against ${expected.base} at ${expected.baseCommit}`);
  const env = { ...process.env, FALLOW_AUDIT_BASE: expected.baseCommit, MUTATION_SCORE_THRESHOLD: "94.8" };
  delete env.MUTATION_SHARD;
  // Git hooks can export an alternate index or repository. Keep those for the
  // snapshot checks above, but do not leak them into tests using fixture repos.
  for (const name of git("rev-parse", "--local-env-vars").split("\n")) delete env[name];
  try {
    for (const result of report.checks) {
      assertCheckout(expected);
      result.status = "running";
      result.startedAt = new Date().toISOString();
      result.log = `${result.command.replaceAll(":", "-")}.log`;
      save(directory, report);
      Object.assign(result, await run(pnpm, ["run", result.command], { env, log: path.join(directory, result.log) }));
      result.finishedAt = new Date().toISOString();
      result.status = result.exitCode === 0 && !result.signal ? "passed" : "failed";
      save(directory, report);
      if (result.status !== "passed") {
        process.exitCode = result.exitCode || 1;
        throw new Error(`pnpm ${result.command} failed${result.signal ? ` (${result.signal})` : ""}.`);
      }
      assertCheckout(expected);
    }
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.error = error.message;
    for (const result of report.checks) {
      if (result.status === "pending") result.status = "skipped";
      if (result.status === "running") result.status = "failed";
    }
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    save(directory, report);
    console.log(`Verification summary: ${path.join(directory, "summary.json")}`);
  }
  console.log(expected.tree ? "Checks passed for the staged tree. Git may create the commit." : "Checks passed for this commit. After publishing it, use pnpm pr:create.");
}

function pushUpdate(args) {
  const lines = readFileSync(0, "utf8").trim().split("\n").filter(Boolean);
  if (lines.length === 0) return null;
  const updates = lines.map((line) => line.trim().split(/\s+/));
  if (updates.some((parts) => parts.length !== 4)) throw new Error("Invalid pre-push input from Git.");
  // Ref deletion publishes no code and needs no verification.
  const publishing = updates.filter(([, sha]) => !/^0+$/.test(sha));
  if (publishing.length === 0) return null;
  const current = checkout();
  const [, sha, target] = publishing[0];
  if (args.length !== 2 || args[0] !== "origin" || args[1] !== git("remote", "get-url", "--push", "origin")) {
    throw new Error("Publish the verified branch through origin using its configured URL.");
  }
  if (updates.length !== 1 || sha !== current.commit || target !== `refs/heads/${current.branch}`) {
    throw new Error("Push only the checked-out branch at HEAD to the same branch name on origin. Other refs and tags need a separate publishing workflow.");
  }
  return { ...current, target };
}

async function create(expected, directory, args) {
  let report;
  try {
    report = JSON.parse(readFileSync(path.join(directory, "summary.json"), "utf8"));
  } catch {
    throw new Error("No readable verification summary for this commit. Run pnpm pr:check first.");
  }
  if (report.version !== 1 || report.status !== "passed" ||
      Object.entries(expected).some(([key, value]) => report[key] !== value) ||
      report.checks?.length !== checks.length ||
      checks.some((command, index) => report.checks[index].command !== command ||
        report.checks[index].status !== "passed" || report.checks[index].exitCode !== 0 || report.checks[index].signal)) {
    throw new Error("Verification is failed, incomplete, or stale. Run pnpm pr:check again.");
  }
  const remoteHead = git("ls-remote", "--exit-code", "origin", `refs/heads/${expected.branch}`).split(/\s+/)[0];
  if (remoteHead !== expected.commit) {
    throw new Error("The published branch does not match the verified commit. Push the verified commit to origin first.");
  }
  assertCheckout(expected);
  const repository = expected.remote.replace(/^git@([^:]+):/, "https://$1/").replace(/\.git$/, "");
  const result = await run("gh", ["pr", "create", "--repo", repository, "--base", expected.base, "--head", expected.branch, ...args]);
  process.exitCode = result.exitCode || (result.signal ? 1 : 0);
}

let lock;
try {
  root = git("rev-parse", "--show-toplevel");
  const { mode, base, forwarded } = options();
  const update = mode === "pre-push" ? pushUpdate(forwarded) : undefined;
  if (update === null) process.exit(0);
  const lockPath = git("rev-parse", "--path-format=absolute", "--git-path", "pr-check.lock");
  try {
    mkdirSync(lockPath);
    lock = lockPath;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    throw new Error(`Another PR command holds ${lockPath}. If it was killed, remove that directory before retrying.`, { cause: error });
  }
  const expected = identity(base, mode === "pre-commit");
  if (update && (update.commit !== expected.commit || update.branch !== expected.branch)) {
    throw new Error("The checkout changed after Git prepared the push. Retry the push.");
  }
  const directory = path.join(root, "reports", "pr-check", expected.commit ?? path.join("staged", expected.tree));
  mkdirSync(directory, { recursive: true });
  if (mode === "create") await create(expected, directory, forwarded);
  else await check(expected, directory);
} catch (error) {
  console.error(`PR blocked: ${error.message}`);
  process.exitCode ||= 1;
} finally {
  if (lock) rmSync(lock, { recursive: true });
}
