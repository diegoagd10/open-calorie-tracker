import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ImageStorage } from "../src/storage/images.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

test("images are stored outside public with managed safe names and can be removed", async () => {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "calories-images-"));
  directories.push(dataDir);
  const storage = new ImageStorage(dataDir);
  const image = await storage.save({ buffer: Buffer.from("fake image"), mimeType: "image/png", originalName: "label.png" });
  assert.match(image.managedName, /^[0-9a-f-]+\.png$/);
  assert.equal((await storage.read(image.managedName)).toString(), "fake image");
  assert.match(storage.directory, /images$/);
  assert.throws(() => storage.safePath("../secret.png"));
  await storage.delete(image.managedName);
  await assert.rejects(storage.read(image.managedName));
});
