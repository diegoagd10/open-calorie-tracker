import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import mutationConfig from "../stryker.config.mjs";

test("real Stryker worker mutations receive activation and measured per-test coverage", { timeout: 30000 }, async t => {
  const directory = await mkdtemp(path.join(tmpdir(), "mutation-workers-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await symlink(path.resolve("node_modules"), path.join(directory, "node_modules"), "dir");
  await mkdir(path.join(directory, "tests/support"), { recursive: true });
  for (const file of ["mutation-worker-setup.ts", "mutation-worker-preload.mjs"]) {
    await copyFile(path.join("tests/support", file), path.join(directory, "tests/support", file));
  }
  await writeFile(path.join(directory, "package.json"), '{"type":"module"}');
  await writeFile(path.join(directory, "worker.js"), `import { parentPort, workerData } from 'node:worker_threads';
import { mode } from './shared.js';
parentPort.postMessage({ value: workerData * 2, metadata: mode });
`);
  await writeFile(path.join(directory, "shared.js"), "export const mode = 'double';\n");
  await writeFile(path.join(directory, "main.js"), "import { mode } from './shared.js';\nexport function double(value) { return value * (mode === 'double' ? 2 : 3); }\n");
  await writeFile(path.join(directory, "tests/double.test.ts"), `import { Worker } from 'node:worker_threads';
import { once } from 'node:events';
import path from 'node:path';
import { expect, test } from 'vitest';
import { double } from '../main.js';
test('doubles through the real worker', async () => {
  expect(double(7)).toBe(14);
  const worker = new Worker(path.resolve('worker.js'), { workerData: 7, execArgv: [] });
  const finished = once(worker, 'exit');
  const [value] = await once(worker, 'message');
  await finished;
  expect(value.value).toBe(14);
});
`);
  await writeFile(path.join(directory, "vitest.config.mjs"), "export default { test: { setupFiles: ['tests/support/mutation-worker-setup.ts'] } };\n");
  await writeFile(path.join(directory, "stryker.config.mjs"), `export default {
  plugins: ['@stryker-mutator/vitest-runner'], testRunner: 'vitest',
  mutate: ['main.js', 'worker.js', 'shared.js'], coverageAnalysis: 'perTest', ignoreStatic: true, concurrency: 1,
  reporters: ['json'], jsonReporter: { fileName: 'result.json' },
  vitest: { configFile: 'vitest.config.mjs', related: ${JSON.stringify(mutationConfig.vitest.related)} }
};\n`);
  await promisify(execFile)(process.execPath, [path.resolve("node_modules/@stryker-mutator/core/bin/stryker.js"), "run"], { cwd: directory, timeout: 25000 });
  const report = JSON.parse(await readFile(path.join(directory, "result.json"), "utf8"));
  const mutation = report.files["worker.js"].mutants.find(mutant => mutant.mutatorName === "ArithmeticOperator");
  assert.equal(mutation.status, "Killed");
  assert.ok(mutation.coveredBy.length > 0);
  assert.ok(mutation.killedBy.length > 0);
  assert.equal(report.files["shared.js"].mutants[0].status, "Killed", "hybrid module-initialization mutations must also affect the importing test thread");
});
