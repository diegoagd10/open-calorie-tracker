import type { Route } from "./+types/oauth.token";
import { ACCESS_TOKEN_SECONDS, DAILY_LOG_READ_SCOPE, exchangeOAuthToken, type OAuthClientAuthentication } from "../oauth/authorization.server";

const responseHeaders = { "Cache-Control": "no-store", Pragma: "no-cache" };

function tokenError(error: string, challenge = false) {
  return Response.json({ error }, { status: challenge ? 401 : 400, headers: {
    ...responseHeaders, ...(challenge ? { "WWW-Authenticate": 'Basic realm="oauth-token"' } : {}),
  } });
}

function basicClientAuthentication(header: string): OAuthClientAuthentication | undefined {
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/iu.exec(header);
  if (!match) return undefined;
  const decoded = Buffer.from(match[1], "base64");
  if (decoded.toString("base64") !== match[1]) return undefined;
  const separator = decoded.indexOf(":");
  if (separator < 1) return undefined;
  const clientId = decoded.subarray(0, separator).toString("ascii");
  const secret = decoded.subarray(separator + 1).toString("ascii");
  if (!/^[A-Za-z0-9_-]{32}$/u.test(clientId) || !/^[A-Za-z0-9_-]{43}$/u.test(secret)) return undefined;
  return { clientId, secret };
}

export async function action({ request }: Route.ActionArgs) {
  if (request.headers.get("Content-Type")?.split(";", 1)[0]?.trim() !== "application/x-www-form-urlencoded") {
    return tokenError("invalid_request");
  }
  const body = await request.text();
  if (body.length > 4_096) return tokenError("invalid_request");
  const authorization = request.headers.get("Authorization");
  const clientAuthentication = authorization ? basicClientAuthentication(authorization) : undefined;
  if (authorization && !clientAuthentication) return tokenError("invalid_client", true);
  const result = exchangeOAuthToken(new URLSearchParams(body), clientAuthentication);
  if (!result.ok) return tokenError(result.error, result.challenge);
  return Response.json({
    access_token: result.accessToken,
    refresh_token: result.refreshToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_SECONDS,
    scope: DAILY_LOG_READ_SCOPE,
  }, { headers: responseHeaders });
}
