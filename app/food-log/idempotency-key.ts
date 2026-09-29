/** Where an external caller's idempotency key came from: the MCP endpoint or the REST API. */
export type ExternalChannel = "mcp" | "api";

/** At most 124 characters, so the stored key with its 4-character prefix fits the 128 that stored keys allow. */
const EXTERNAL_CALLER_KEY = /^[A-Za-z0-9._:-]{8,124}$/u;
const EXTERNAL_CHANNEL_PREFIX = /^(?:mcp|api):/u;

/**
 * The stored form of an external caller's key, prefixed by its channel so MCP,
 * REST, and web keys never replay each other; undefined when the caller's key
 * breaks the contract.
 */
export function storedExternalIdempotencyKey(channel: ExternalChannel, callerKey: unknown): string | undefined {
  if (typeof callerKey !== "string" || !EXTERNAL_CALLER_KEY.test(callerKey)) return undefined;
  return `${channel}:${callerKey}`;
}

/** Whether a key carries an external channel prefix, which web keys must not. */
export function hasExternalChannelPrefix(key: string): boolean {
  return EXTERNAL_CHANNEL_PREFIX.test(key);
}
