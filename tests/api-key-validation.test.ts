import { expect, test } from "vitest";
import { parseApiKeyFields } from "../app/api-keys/validation";

function parse(fields: Record<string, string | readonly string[]>) {
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const entry of [value].flat()) form.append(name, entry);
  }
  return parseApiKeyFields(form);
}

test("a valid submission is trimmed, de-duplicated, and typed for the service", () => {
  expect(parse({ name: "  Muse  ", scope: ["daily-log:read", "daily-log:read"], expiration: "90d" }))
    .toEqual({ success: true, data: { name: "Muse", scopes: ["daily-log:read"], expiration: "90d" } });
});

test.each([
  [{ name: "", scope: "daily-log:read", expiration: "90d" }, "name"],
  [{ name: "x".repeat(81), scope: "daily-log:read", expiration: "90d" }, "name"],
  [{ name: "Tab\there", scope: "daily-log:read", expiration: "90d" }, "name"],
  [{ name: "Muse", expiration: "90d" }, "scopes"],
  [{ name: "Muse", scope: ["daily-log:read", "daily-log:write"], expiration: "90d" }, "scopes"],
  [{ name: "Muse", scope: "daily-log:read", expiration: "2027-01-01" }, "expiration"],
  [{ name: "Muse", scope: "daily-log:read" }, "expiration"],
] as const)("an invalid field is rejected before reaching the service: %j", (fields, field) => {
  const result = parse(fields);
  expect(result.success).toBe(false);
  expect(result.success ? {} : Object.keys(result.errors)).toEqual([field]);
});
