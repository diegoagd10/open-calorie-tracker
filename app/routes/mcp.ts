import type { Route } from "./+types/mcp";
import { apiError, privateHeaders } from "../api-keys/rest.server";
import { getApiKeyAuthenticator } from "../api-keys/runtime.server";
import { getClientIp } from "../auth/http.server";
import { allowsAnyTool, handleMcpRequest, toolScopes, type McpCaller } from "../mcp/server.server";

/** The API key's caller, or the HTTP refusal; nothing reaches the tools without a valid key. */
function authenticate(request: Request): McpCaller | Response {
  const caller = getApiKeyAuthenticator().authenticate(request.headers.get("Authorization"), getClientIp(request), null);
  if (!caller.ok) {
    if (caller.error === "rate_limited") return apiError("rate_limited", 429, { "Retry-After": String(caller.retryAfterSeconds) });
    return apiError("invalid_token", 401, { "WWW-Authenticate": 'Bearer realm="mcp", error="invalid_token"' });
  }
  if (!allowsAnyTool(caller.scopes)) {
    return apiError("insufficient_scope", 403, { "WWW-Authenticate": `Bearer realm="mcp", error="insufficient_scope", scope="${toolScopes()}"` });
  }
  return { userId: caller.userId, scopes: caller.scopes };
}

async function serve(request: Request) {
  const caller = authenticate(request);
  if (caller instanceof Response) return caller;
  if (request.method !== "POST") return apiError("method_not_allowed", 405, { Allow: "POST" });
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
