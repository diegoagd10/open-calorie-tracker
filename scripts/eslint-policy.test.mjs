import assert from "node:assert/strict";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { ESLint } from "eslint";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const eslint = new ESLint({ cwd: repositoryRoot });
const directEnvironmentRead =
  "export const policyProbe = process.env.POLICY_PROBE;";

test("direct environment reads fail outside runtime boundaries", async () => {
  const [result] = await eslint.lintText(directEnvironmentRead, {
    filePath: path.join(repositoryRoot, "app", "root.tsx"),
  });

  assert.ok(
    result.messages.some(
      (message) => message.ruleId === "no-restricted-properties",
    ),
  );
});

test("runtime boundaries may read environment variables", async () => {
  const [result] = await eslint.lintText(directEnvironmentRead, {
    filePath: path.join(repositoryRoot, "app", "runtime.server.ts"),
  });

  assert.deepEqual(result.messages, []);
});
