import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const script = path.join(import.meta.dirname, "pr.mjs");

function fixture(t) {
  const directory = mkdtempSync(path.join(tmpdir(), "pr-gate-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = path.join(directory, "checkout");
  const origin = path.join(directory, "origin.git");
  const bin = path.join(directory, "bin");
  mkdirSync(root);
  mkdirSync(bin);
  mkdirSync(path.join(root, "scripts"));
  mkdirSync(path.join(root, ".githooks"));
  copyFileSync(script, path.join(root, "scripts", "pr.mjs"));
  for (const name of ["pre-commit", "pre-push"]) {
    copyFileSync(path.join(import.meta.dirname, "..", ".githooks", name), path.join(root, ".githooks", name));
    chmodSync(path.join(root, ".githooks", name), 0o755);
  }
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--initial-branch=main");
  git("config", "user.name", "PR gate test");
  git("config", "user.email", "pr-gate@example.test");
  git("config", "commit.gpgsign", "false");
  writeFileSync(path.join(root, ".gitignore"), "reports/\n");
  writeFileSync(path.join(root, "source.txt"), "base\n");
  git("add", ".");
  git("commit", "-m", "base");
  git("init", "--bare", origin);
  git("remote", "add", "origin", origin);
  git("push", "origin", "main");
  git("switch", "-c", "feature/test");
  writeFileSync(path.join(root, "source.txt"), "feature\n");
  git("commit", "-am", "feature");
  const commit = git("rev-parse", "HEAD");
  const calls = path.join(directory, "calls.jsonl");
  const fakeTool = `#!${process.execPath}
const { appendFileSync, writeFileSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const tool = require('node:path').basename(process.argv[1]);
const args = process.argv.slice(2);
appendFileSync(process.env.PR_TEST_CALLS, JSON.stringify({tool, args, base:process.env.FALLOW_AUDIT_BASE, shard:process.env.MUTATION_SHARD, threshold:process.env.MUTATION_SCORE_THRESHOLD, index:process.env.GIT_INDEX_FILE, gitDir:process.env.GIT_DIR})+'\\n');
console.log(tool + ' stdout'); console.error(tool + ' stderr');
if (tool === 'pnpm' && args[1] === 'verify:deep') {
  const git = (...args) => execFileSync('git', args);
  if (process.env.PR_TEST_CHANGE === 'dirty') writeFileSync('source.txt', 'changed during checks');
  if (process.env.PR_TEST_CHANGE === 'commit') git('commit', '--allow-empty', '-m', 'changed during checks');
  if (process.env.PR_TEST_CHANGE === 'branch') git('switch', '-c', 'feature/changed');
  if (process.env.PR_TEST_CHANGE === 'index') { writeFileSync('source.txt', 'new staged content'); git('add', 'source.txt'); }
  if (process.env.PR_TEST_CHANGE === 'signal') process.kill(process.pid, 'SIGTERM');
}
if (tool === 'pnpm' && args[1] === process.env.PR_TEST_FAIL) process.exit(7);
`;
  for (const name of ["pnpm", "gh"]) {
    const file = path.join(bin, name);
    writeFileSync(file, fakeTool);
    chmodSync(file, 0o755);
  }
  const run = (mode = "check", args = [], env = {}) => spawnSync(process.execPath, [script, mode, ...args], {
    cwd: root, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, PR_TEST_CALLS: calls, ...env },
  });
  const summaryPath = path.join(root, "reports", "pr-check", commit, "summary.json");
  const summary = () => JSON.parse(readFileSync(summaryPath, "utf8"));
  const invocations = () => {
    try { return readFileSync(calls, "utf8").trim().split("\n").map((line) => JSON.parse(line)); }
    catch { return []; }
  };
  const gitRun = (args, env = {}) => spawnSync("git", args, {
    cwd: root, encoding: "utf8", env: { ...process.env, PATH: `${bin}:${path.dirname(process.execPath)}:${process.env.PATH}`, PR_TEST_CALLS: calls, ...env },
  });
  const install = () => spawnSync(process.execPath, [path.join(import.meta.dirname, "install-git-hooks.mjs")], { cwd: root, encoding: "utf8" });
  return { root, git, gitRun, install, run, commit, summary, summaryPath, invocations };
}

function passed(result) {
  assert.equal(result.status, 0, result.stdout + result.stderr);
}
function blocked(result, pattern) {
  assert.notEqual(result.status, 0, result.stdout + result.stderr);
  if (pattern) assert.match(result.stderr, pattern);
}

test("checks the exact commit, stores logs, and creates only the published verified PR", (t) => {
  const f = fixture(t);
  passed(f.run("check", [], { MUTATION_SHARD: "1/8", MUTATION_SCORE_THRESHOLD: "0" }));
  const report = f.summary();
  assert.equal(report.status, "passed");
  assert.equal(report.commit, f.commit);
  assert.equal(report.branch, "feature/test");
  assert.equal(report.baseCommit, f.git("rev-parse", "main"));
  assert.deepEqual(report.checks.map((check) => check.command), ["verify:deep", "test:deployment"]);
  for (const call of f.invocations()) {
    assert.equal(call.base, report.baseCommit);
    assert.equal(call.shard, undefined);
    assert.equal(call.threshold, "94.8");
  }
  const log = readFileSync(path.join(path.dirname(f.summaryPath), "verify-deep.log"), "utf8");
  assert.match(log, /pnpm stdout/);
  assert.match(log, /pnpm stderr/);
  blocked(f.run("create"));
  assert.equal(f.invocations().length, 2);
  f.git("push", "origin", "HEAD");
  passed(f.run("create", ["--draft", "--title", "A reviewed change", "--body", "Checks passed."]));
  const invocation = f.invocations().at(-1);
  assert.equal(invocation.tool, "gh");
  assert.deepEqual(invocation.args, ["pr", "create", "--repo", report.remote.replace(/\.git$/, ""), "--base", "main", "--head", report.branch, "--draft", "--title", "A reviewed change", "--body", "Checks passed."]);
});

for (const command of ["verify:deep", "test:deployment"]) {
  test(`a failed ${command} replaces an old pass and blocks creation`, (t) => {
    const f = fixture(t);
    passed(f.run());
    f.git("push", "origin", "HEAD");
    const result = f.run("check", [], { PR_TEST_FAIL: command });
    assert.equal(result.status, 7);
    const report = f.summary();
    assert.equal(report.status, "failed");
    assert.equal(report.checks.find((check) => check.command === command).exitCode, 7);
    if (command === "verify:deep") assert.equal(report.checks[1].status, "skipped");
    blocked(f.run("create"), /failed, incomplete, or stale/);
    assert.ok(f.invocations().every((call) => call.tool === "pnpm"));
  });
}

for (const change of ["dirty", "commit", "branch", "signal"]) {
  test(`${change} during verification cannot produce a pass`, (t) => {
    const f = fixture(t);
    blocked(f.run("check", [], { PR_TEST_CHANGE: change }));
    assert.equal(f.summary().status, "failed");
    assert.equal(f.summary().checks[1].status, "skipped");
    assert.equal(f.invocations().length, 1);
  });
}

for (const state of ["unstaged", "staged", "untracked", "detached", "base", "empty"]) {
  test(`rejects ${state} checkout before running checks`, (t) => {
    const f = fixture(t);
    if (state === "unstaged" || state === "staged") writeFileSync(path.join(f.root, "source.txt"), "dirty");
    if (state === "staged") f.git("add", ".");
    if (state === "untracked") writeFileSync(path.join(f.root, "extra.txt"), "untracked");
    if (state === "detached") f.git("checkout", "--detach");
    if (state === "base") f.git("switch", "main");
    if (state === "empty") f.git("reset", "--hard", "main");
    blocked(f.run());
    assert.deepEqual(f.invocations(), []);
  });
}

test("requires a readable and complete success record", (t) => {
  const f = fixture(t);
  f.git("push", "origin", "HEAD");
  blocked(f.run("create"), /No readable/);
  passed(f.run());
  const report = f.summary();
  for (const contents of ["{", JSON.stringify({ ...report, status: "running" }), JSON.stringify({ ...report, checks: [] })]) {
    writeFileSync(f.summaryPath, contents);
    blocked(f.run("create"));
  }
  assert.ok(f.invocations().every((call) => call.tool === "pnpm"));
});

for (const change of ["commit", "branch", "base", "remote-head"]) {
  test(`rejects ${change} changed after a pass`, (t) => {
    const f = fixture(t);
    passed(f.run());
    f.git("push", "origin", "HEAD");
    if (change === "commit") f.git("commit", "--amend", "-m", "amended feature");
    if (change === "branch") f.git("branch", "-m", "feature/renamed");
    if (change === "base") f.git("push", "origin", "HEAD:main");
    if (change === "remote-head") f.git("push", "--force", "origin", "main:feature/test");
    blocked(f.run("create"));
    assert.ok(f.invocations().every((call) => call.tool === "pnpm"));
  });
}

test("supports an explicit base and rejects head/repository overrides", (t) => {
  const f = fixture(t);
  f.git("push", "origin", "main:release");
  passed(f.run("check", ["--base", "release"]));
  f.git("push", "origin", "HEAD");
  blocked(f.run("create"), /stale/);
  for (const args of [["--head", "main"], ["--repo=elsewhere/repo"], ["-Bmain"], ["--web"]]) {
    blocked(f.run("create", args), /Unsupported/);
  }
  passed(f.run("create", ["--base", "release", "--fill"]));
});

test("a concurrent invocation cannot reuse or replace a report", (t) => {
  const f = fixture(t);
  passed(f.run());
  mkdirSync(path.join(f.root, ".git", "pr-check.lock"));
  blocked(f.run(), /Another PR command/);
  blocked(f.run("create"), /Another PR command/);
  assert.equal(f.invocations().length, 2);
});

for (const command of ["verify:deep", "test:deployment"]) {
  test(`pre-commit rejects a failing ${command}, preserves staged work, and prints feedback`, (t) => {
    const f = fixture(t);
    passed(f.install());
    writeFileSync(path.join(f.root, "source.txt"), "candidate\n");
    f.git("add", "source.txt");
    const tree = f.git("write-tree");
    const result = f.gitRun(["commit", "-m", "should fail"], { PR_TEST_FAIL: command });
    blocked(result, /PR blocked/);
    assert.match(result.stdout + result.stderr, /pnpm stderr/);
    assert.equal(f.git("rev-parse", "HEAD"), f.commit);
    assert.equal(f.git("write-tree"), tree);
    const report = JSON.parse(readFileSync(path.join(f.root, "reports/pr-check/staged", tree, "summary.json")));
    assert.equal(report.status, "failed");
    assert.equal(report.tree, tree);
    assert.equal(report.parentCommit, f.commit);
    assert.equal(report.commit, undefined);
  });
}

test("pre-commit verifies git commit -a's index and push independently verifies the final SHA", (t) => {
  const f = fixture(t);
  passed(f.install());
  writeFileSync(path.join(f.root, "source.txt"), "candidate\n");
  passed(f.gitRun(["commit", "-am", "verified candidate"]));
  const sha = f.git("rev-parse", "HEAD");
  assert.notEqual(sha, f.commit);
  const stagedReport = JSON.parse(readFileSync(path.join(f.root, "reports/pr-check/staged", f.git("rev-parse", "HEAD^{tree}"), "summary.json")));
  assert.equal(stagedReport.status, "passed");
  assert.equal(f.invocations().length, 2);
  for (const call of f.invocations()) {
    assert.equal(call.index, undefined);
    assert.equal(call.gitDir, undefined);
  }
  blocked(f.run("create"), /No readable/);
  passed(f.gitRun(["push", "origin", "HEAD"]));
  assert.equal(f.invocations().length, 4);
  assert.equal(f.git("ls-remote", "origin", "refs/heads/feature/test").split(/\s+/)[0], sha);
  passed(f.run("create", ["--fill"]));
});

test("pre-commit rejects partial staging before running checks", (t) => {
  const f = fixture(t);
  passed(f.install());
  writeFileSync(path.join(f.root, "source.txt"), "staged\n");
  f.git("add", "source.txt");
  writeFileSync(path.join(f.root, "source.txt"), "unstaged\n");
  blocked(f.gitRun(["commit", "-m", "partial"]), /Partial staging/);
  assert.equal(f.git("rev-parse", "HEAD"), f.commit);
  assert.equal(f.invocations().length, 0);
});

test("changing the staged tree during checks rejects the commit", (t) => {
  const f = fixture(t);
  passed(f.install());
  writeFileSync(path.join(f.root, "source.txt"), "candidate\n");
  f.git("add", "source.txt");
  blocked(f.gitRun(["commit", "-m", "changed index"], { PR_TEST_CHANGE: "index" }));
  assert.equal(f.git("rev-parse", "HEAD"), f.commit);
  assert.equal(f.invocations().length, 1);
});

for (const command of ["verify:deep", "test:deployment"]) {
  test(`pre-push runs ${command} even with an old pass and blocks the remote on failure`, (t) => {
    const f = fixture(t);
    passed(f.run());
    passed(f.install());
    const result = f.gitRun(["push", "origin", "HEAD"], { PR_TEST_FAIL: command });
    blocked(result, /PR blocked/);
    assert.match(result.stdout + result.stderr, /pnpm stderr/);
    assert.equal(f.git("ls-remote", "origin", "refs/heads/feature/test"), "");
    assert.equal(f.summary().status, "failed");
    blocked(f.run("create"), /failed, incomplete, or stale/);
  });
}

for (const refspec of ["HEAD:other", "main:feature/test", "HEAD:refs/tags/release"]) {
  test(`pre-push refuses an unverified refspec ${refspec}`, (t) => {
    const f = fixture(t);
    passed(f.install());
    blocked(f.gitRun(["push", "origin", refspec]), /Push only/);
    assert.equal(f.invocations().length, 0);
  });
}

test("pre-push supports the configured base and deletion needs no tests", (t) => {
  const f = fixture(t);
  f.git("push", "origin", "main:release");
  f.git("config", "pr.base", "release");
  passed(f.install());
  passed(f.gitRun(["push", "origin", "HEAD"]));
  assert.equal(f.summary().base, "release");
  passed(f.gitRun(["push", "origin", "--delete", "feature/test"]));
  assert.equal(f.invocations().length, 2);
});

test("installer is idempotent and preserves an existing hooks setup", (t) => {
  const f = fixture(t);
  passed(f.install());
  passed(f.install());
  f.git("config", "core.hooksPath", "custom-hooks");
  blocked(f.install(), /Existing core.hooksPath/);
  assert.equal(f.git("config", "--get", "core.hooksPath"), "custom-hooks");
});

test("installer respects an existing default hook", (t) => {
  const f = fixture(t);
  const existing = path.join(f.root, ".git/hooks/pre-commit");
  writeFileSync(existing, "#!/bin/sh\nexit 0\n");
  blocked(f.install(), /Existing hook at/);
  assert.equal(readFileSync(existing, "utf8"), "#!/bin/sh\nexit 0\n");
  assert.equal(f.git("config", "--default", "", "--get", "core.hooksPath"), "");
});

test("installer scopes hooks to a linked worktree when worktreeConfig is enabled", (t) => {
  const f = fixture(t);
  f.git("config", "extensions.worktreeConfig", "true");
  const linked = path.join(path.dirname(f.root), "linked");
  f.git("worktree", "add", "-b", "feature/linked", linked);
  passed(spawnSync(process.execPath, [path.join(import.meta.dirname, "install-git-hooks.mjs")], { cwd: linked, encoding: "utf8" }));
  assert.equal(f.git("config", "--default", "", "--get", "core.hooksPath"), "");
  assert.equal(execFileSync("git", ["config", "--get", "core.hooksPath"], { cwd: linked, encoding: "utf8" }).trim(), ".githooks");
});

test("pre-push rejects multiple publishing refs and a different remote", (t) => {
  const f = fixture(t);
  passed(f.install());
  blocked(f.gitRun(["push", "origin", "HEAD:feature/test", "HEAD:feature/second"]), /Push only/);
  f.git("remote", "add", "elsewhere", f.git("remote", "get-url", "origin"));
  blocked(f.gitRun(["push", "elsewhere", "HEAD"]), /through origin/);
  assert.equal(f.git("ls-remote", "origin", "refs/heads/feature/*"), "");
  assert.equal(f.invocations().length, 0);
});
