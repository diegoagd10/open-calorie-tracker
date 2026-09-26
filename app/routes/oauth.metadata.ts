import { effectiveRequestPolicy } from "../runtime.server";

export function loader() {
  const issuer = effectiveRequestPolicy().origin;
  return Response.json({
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: ["daily-log:read"],
    token_endpoint_auth_methods_supported: ["none"],
  }, { headers: { "Cache-Control": "no-store" } });
}
