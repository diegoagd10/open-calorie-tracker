import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.js";

test("MAX_IMAGE_BYTES must be a positive integer", () => {
  assert.throws(() => loadConfig({ MAX_IMAGE_BYTES: "0" }), /MAX_IMAGE_BYTES/i);
  assert.throws(() => loadConfig({ MAX_IMAGE_BYTES: "-1" }), /MAX_IMAGE_BYTES/i);
  assert.throws(() => loadConfig({ MAX_IMAGE_BYTES: "1.5" }), /MAX_IMAGE_BYTES/i);
  assert.equal(loadConfig({ MAX_IMAGE_BYTES: "2048" }).maxImageBytes, 2048);
});
