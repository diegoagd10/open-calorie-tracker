import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

test("production startup does not apply migrations implicitly", async () => {
  const dockerfile = await fs.readFile(path.resolve("Dockerfile"), "utf8");
  const deployment = await fs.readFile(path.resolve("docs/deployment.md"), "utf8");
  assert.match(dockerfile, /CMD \["node", "dist\/src\/server\.js"\]/);
  assert.doesNotMatch(dockerfile, /migrate/);
  assert.match(deployment, /docker compose run --rm calories node dist\/src\/cli\.js migrate/);
});
