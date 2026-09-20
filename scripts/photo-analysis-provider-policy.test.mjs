import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const repository = path.resolve(import.meta.dirname, "..");

async function text(file) {
  return await readFile(path.join(repository, file), "utf8");
}

async function sourceFiles(directory) {
  const absolute = path.join(repository, directory);
  const entries = await readdir(absolute, { withFileTypes: true });
  const files = await Promise.all(entries.map(async entry => {
    const relative = path.join(directory, entry.name);
    return entry.isDirectory() ? sourceFiles(relative) : [relative];
  }));
  return files.flat().filter(file => /\.(?:js|mjs|ts|tsx)$/u.test(file));
}

test("the retired photo provider has no dependency, runtime, environment, or test seam", async () => {
  const packageManifest = JSON.parse(await text("package.json"));
  const dependencyNames = Object.keys({
    ...packageManifest.dependencies,
    ...packageManifest.devDependencies,
  });
  assert.equal(dependencyNames.some(name => name.includes("pi-coding-agent")), false);

  const files = [
    ...(await sourceFiles("app")),
    ...(await sourceFiles("tests")),
    ".fallowrc.json",
    "playwright.config.ts",
    "playwright.catalog.config.ts",
    "docker-compose.yml",
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
  ];
  const retired = /@earendil-works\/pi|PHOTO_AI_|PiPhotoAnalyzer|PiConnectionService|pi-oauth-fixture/iu;
  const violations = [];
  for (const file of files) {
    if (retired.test(await text(file))) violations.push(file);
  }
  assert.deepEqual(violations, []);
});

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
