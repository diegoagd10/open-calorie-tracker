/** Choices shared by the API keys form and the service that validates them. */
export const MAX_API_KEYS_PER_ACCOUNT = 25;

export const API_KEY_SCOPES = [{ scope: "daily-log:read", label: "Read Food Log" }] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number]["scope"];

export function isApiKeyScope(value: string): value is ApiKeyScope {
  return API_KEY_SCOPES.some((entry) => entry.scope === value);
}

export const EXPIRATION_PRESETS = [
  { value: "1d", label: "1 day", days: 1 },
  { value: "7d", label: "7 days", days: 7 },
  { value: "30d", label: "30 days", days: 30 },
  { value: "90d", label: "90 days", days: 90 },
  { value: "1y", label: "1 year", days: 365 },
  { value: "never", label: "No expiration", days: null },
] as const;
export const DEFAULT_EXPIRATION = "90d";
