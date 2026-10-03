import { getClientIp } from "../auth/http.server";
import type { ApiKeyScope } from "./presets";
import { getApiKeyAuthenticator } from "./runtime.server";

/** Headers on every REST API response: never cached, never leaked through a referrer. */
export const privateHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

/** A REST API error: a `snake_case` code in a private JSON body. */
export function apiError(error: string, status: number, headers: Record<string, string> = {}) {
  return Response.json({ error }, { status, headers: { ...privateHeaders, ...headers } });
}

/**
 * The account behind the request's API key when the key holds `requiredScope`, or the
 * refusal to send: `401`, `403`, or `429` with the realm's `WWW-Authenticate` challenge.
 */
export function authenticateApiRequest(
  request: Request,
  realm: string,
  requiredScope: ApiKeyScope,
): { userId: number } | Response {
  const caller = getApiKeyAuthenticator().authenticate(request.headers.get("Authorization"), getClientIp(request), requiredScope);
  if (caller.ok) return { userId: caller.userId };
  if (caller.error === "rate_limited") return apiError("rate_limited", 429, { "Retry-After": String(caller.retryAfterSeconds) });
  return caller.error === "insufficient_scope"
    ? apiError("insufficient_scope", 403, { "WWW-Authenticate": `Bearer realm="${realm}", error="insufficient_scope", scope="${requiredScope}"` })
    : apiError("invalid_token", 401, { "WWW-Authenticate": `Bearer realm="${realm}", error="invalid_token"` });
}
