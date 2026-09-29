/** Idempotency keys sent by external callers: 8–124 characters from `[A-Za-z0-9._:-]`. */
export const EXTERNAL_IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,124}$/u;

/**
 * The stored form of an external caller's idempotency key, prefixed by its channel so
 * REST and MCP keys never replay each other, or undefined when the key is missing or malformed.
 */
export function externalIdempotencyKey(channel: "api" | "mcp", value: string | null | undefined): string | undefined {
  return value != null && EXTERNAL_IDEMPOTENCY_KEY.test(value) ? `${channel}:${value}` : undefined;
}
