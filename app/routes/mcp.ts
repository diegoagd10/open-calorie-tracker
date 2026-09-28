import type { Route } from "./+types/mcp";
import { getApiKeyAuthenticator } from "../api-keys/runtime.server";
import { getClientIp } from "../auth/http.server";
import { allowsAnyTool, handleMcpRequest, toolScopes, type McpCaller } from "../mcp/server.server";

const privateHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

function httpError(error: string, status: number, headers: Record<string, string> = {}) {
  return Response.json({ error }, { status, headers: { ...privateHeaders, ...headers } });
}

/** The API key's caller, or the HTTP refusal; nothing reaches the tools without a valid key. */
function authenticate(request: Request): McpCaller | Response {
  const caller = getApiKeyAuthenticator().authenticate(request.headers.get("Authorization"), getClientIp(request), null);
  if (!caller.ok) {
    if (caller.error === "rate_limited") return httpError("rate_limited", 429, { "Retry-After": String(caller.retryAfterSeconds) });
    return httpError("invalid_token", 401, { "WWW-Authenticate": 'Bearer realm="mcp", error="invalid_token"' });
  }
  if (!allowsAnyTool(caller.scopes)) {
    return httpError("insufficient_scope", 403, { "WWW-Authenticate": `Bearer realm="mcp", error="insufficient_scope", scope="${toolScopes()}"` });
  }
  return { userId: caller.userId, scopes: caller.scopes };
}

async function serve(request: Request) {
  const caller = authenticate(request);
  if (caller instanceof Response) return caller;
  if (request.method !== "POST") return httpError("method_not_allowed", 405, { Allow: "POST" });
  const response = await handleMcpRequest(request, caller);
  for (const [name, value] of Object.entries(privateHeaders)) response.headers.set(name, value);
  return response;
}

export function loader({ request }: Route.LoaderArgs) {
  return serve(request);
}

export function action({ request }: Route.ActionArgs) {
  return serve(request);
}
