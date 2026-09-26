import type { Route } from "./+types/oauth.token";
import { ACCESS_TOKEN_SECONDS, DAILY_LOG_READ_SCOPE, exchangePublicToken } from "../oauth/authorization.server";

const responseHeaders = { "Cache-Control": "no-store", Pragma: "no-cache" };

function tokenError(error: string, status = 400) {
  return Response.json({ error }, { status, headers: responseHeaders });
}

export async function action({ request }: Route.ActionArgs) {
  if (request.headers.get("Content-Type")?.split(";", 1)[0]?.trim() !== "application/x-www-form-urlencoded") {
    return tokenError("invalid_request");
  }
  const body = await request.text();
  if (body.length > 4_096) return tokenError("invalid_request");
  const result = exchangePublicToken(new URLSearchParams(body));
  if (!result.ok) return tokenError(result.error);
  return Response.json({
    access_token: result.accessToken,
    refresh_token: result.refreshToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_SECONDS,
    scope: DAILY_LOG_READ_SCOPE,
  }, { headers: responseHeaders });
}
