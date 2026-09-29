import { expect, test } from "vitest";
import { hasExternalChannelPrefix, storedExternalIdempotencyKey } from "../app/food-log/idempotency-key";

test("external keys are stored under their channel so MCP and REST never replay each other", () => {
  expect(storedExternalIdempotencyKey("mcp", "breakfast-2026.09:29_1")).toBe("mcp:breakfast-2026.09:29_1");
  expect(storedExternalIdempotencyKey("api", "breakfast-2026.09:29_1")).toBe("api:breakfast-2026.09:29_1");
  expect(hasExternalChannelPrefix("mcp:breakfast")).toBe(true);
  expect(hasExternalChannelPrefix("api:breakfast")).toBe(true);
  expect(hasExternalChannelPrefix("copy:1:breakfast")).toBe(false);
  expect(hasExternalChannelPrefix("breakfast-mcp:1")).toBe(false);
});

test("external keys are 8 to 124 characters from a URL-safe alphabet", () => {
  expect(storedExternalIdempotencyKey("mcp", "a".repeat(8))).toBe(`mcp:${"a".repeat(8)}`);
  expect(storedExternalIdempotencyKey("api", "a".repeat(124))).toBe(`api:${"a".repeat(124)}`);
  for (const key of ["a".repeat(7), "a".repeat(125), "has space", "slash/key1", "ñandú-key", "", undefined, 12345678]) {
    expect(storedExternalIdempotencyKey("mcp", key)).toBeUndefined();
  }
});
