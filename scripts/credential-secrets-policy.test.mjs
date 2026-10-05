import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repository = path.resolve(import.meta.dirname, "..");

async function text(file) {
  return await readFile(path.join(repository, file), "utf8");
}

test("production deployment keeps application data and generic secrets on separate persistent mounts", async () => {
  const compose = await text("docker-compose.yml");
  const dockerfile = await text("Dockerfile");
  assert.match(compose, /APPLICATION_SECRETS_PATH/u);
  assert.match(compose, /APPLICATION_MASTER_KEY_PATH/u);
  assert.match(compose, /source: "\$\{DATA_PATH:/u);
  assert.match(compose, /source: "\$\{APPLICATION_SECRETS_MOUNT_PATH:/u);
  assert.doesNotMatch(compose, /APPLICATION_SECRETS_MOUNT_PATH[^\n]*DATA_PATH/u);
  assert.match(dockerfile, /chmod 0700 \/app\/secrets/u);
  assert.match(dockerfile, /USER node/u);
});
