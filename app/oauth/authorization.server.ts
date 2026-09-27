import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { findOAuthClient } from "../database/oauth-clients.server";
import { exchangeOAuthAuthorizationCode, findOAuthAccessToken, listOAuthConnections, revokeOAuthConnection, rotateOAuthRefreshToken, saveOAuthAuthorizationCode } from "../database/oauth-authorization.server";

export const DAILY_LOG_READ_SCOPE = "daily-log:read";
export const ACCESS_TOKEN_SECONDS = 900;
const CODE_LIFETIME_MS = 5 * 60 * 1_000;

export type OAuthAuthorizationRequest = {
  clientId: string;
  clientName: string;
  redirectUri: string;
  codeChallenge: string;
  state: string;
};

function oneParameter(parameters: URLSearchParams, name: string): string | undefined {
  const values = parameters.getAll(name);
  return values.length === 1 ? values[0] : undefined;
}

export function readOAuthAuthorizationRequest(parameters: URLSearchParams): OAuthAuthorizationRequest | undefined {
  const clientId = oneParameter(parameters, "client_id");
  const redirectUri = oneParameter(parameters, "redirect_uri");
  const state = oneParameter(parameters, "state");
  const challenge = oneParameter(parameters, "code_challenge");
  if (
    oneParameter(parameters, "response_type") !== "code" ||
    oneParameter(parameters, "scope") !== DAILY_LOG_READ_SCOPE ||
    oneParameter(parameters, "code_challenge_method") !== "S256" ||
    !clientId || !redirectUri || !state || !challenge ||
    state.length < 16 || state.length > 512 || /[\p{Cc}\p{Cf}]/u.test(state) ||
    !/^[A-Za-z0-9_-]{43}$/u.test(challenge)
  ) return undefined;
  const client = findOAuthClient(clientId);
  if (!client || !(JSON.parse(client.redirectUris) as string[]).includes(redirectUri)) {
    return undefined;
  }
  return { clientId, clientName: client.name, redirectUri, codeChallenge: challenge, state };
}

export function oauthAuthorizationReturnPath(candidate: string | null): string | undefined {
  if (!candidate?.startsWith("/oauth/authorize?") || candidate.length > 4_096) return undefined;
  try {
    const url = new URL(candidate, "http://application.local");
    if (url.pathname !== "/oauth/authorize" || url.hash || !readOAuthAuthorizationRequest(url.searchParams)) return undefined;
    return url.pathname + url.search;
  } catch {
    return undefined;
  }
}

function opaqueValue(): string {
  return randomBytes(32).toString("base64url");
}

function hashValue(value: string): string {
  return createHash("sha256").update(value, "ascii").digest("hex");
}

export function authorizationRedirect(request: OAuthAuthorizationRequest, response: { code: string } | { error: "access_denied" }): string {
  const callback = new URL(request.redirectUri);
  if ("code" in response) callback.searchParams.set("code", response.code);
  else callback.searchParams.set("error", response.error);
  callback.searchParams.set("state", request.state);
  return callback.href;
}

export function approveOAuthAuthorization(userId: number, request: OAuthAuthorizationRequest): string {
  const code = opaqueValue();
  const now = new Date();
  saveOAuthAuthorizationCode({
    clientId: request.clientId,
    userId,
    codeHash: hashValue(code),
    redirectUri: request.redirectUri,
    codeChallenge: request.codeChallenge,
    createdAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CODE_LIFETIME_MS).toISOString(),
  });
  return code;
}

export type OAuthTokenExchange =
  | { ok: true; accessToken: string; refreshToken: string }
  | { ok: false; error: "invalid_request" | "invalid_client" | "invalid_grant" | "invalid_scope" | "unsupported_grant_type"; challenge?: boolean };

export type OAuthClientAuthentication = { clientId: string; secret: string };

function authenticateTokenClient(clientId: string, authentication?: OAuthClientAuthentication): OAuthTokenExchange | undefined {
  const client = findOAuthClient(clientId);
  if (!client) return { ok: false, error: "invalid_client", challenge: Boolean(authentication) };
  if (client.type === "public") return authentication ? { ok: false, error: "invalid_client", challenge: true } : undefined;
  if (!authentication || authentication.clientId !== clientId || !client.secretHash) {
    return { ok: false, error: "invalid_client", challenge: true };
  }
  const received = Buffer.from(hashValue(authentication.secret), "hex");
  const expected = Buffer.from(client.secretHash, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected)
    ? undefined : { ok: false, error: "invalid_client", challenge: true };
}

function redeemOAuthAuthorizationCode(parameters: URLSearchParams, authentication?: OAuthClientAuthentication): OAuthTokenExchange {
  if (parameters.has("client_id") && !oneParameter(parameters, "client_id")) return { ok: false, error: "invalid_request" };
  const code = oneParameter(parameters, "code");
  const clientId = oneParameter(parameters, "client_id") ?? authentication?.clientId;
  const redirectUri = oneParameter(parameters, "redirect_uri");
  const verifier = oneParameter(parameters, "code_verifier");
  if (!code || !clientId || !redirectUri || !verifier ||
      !/^[A-Za-z0-9_-]{43}$/u.test(code) ||
      !/^[A-Za-z0-9._~-]{43,128}$/u.test(verifier)) {
    return { ok: false, error: "invalid_request" };
  }
  const clientFailure = authenticateTokenClient(clientId, authentication);
  if (clientFailure) return clientFailure;
  const challenge = createHash("sha256").update(verifier, "ascii").digest("base64url");
  const accessToken = opaqueValue();
  const refreshToken = opaqueValue();
  const now = new Date();
  const exchanged = exchangeOAuthAuthorizationCode({
    codeHash: hashValue(code),
    clientId,
    redirectUri,
    codeChallenge: challenge,
    tokenHash: hashValue(accessToken),
    refreshHash: hashValue(refreshToken),
    now: now.toISOString(),
    expiresAt: new Date(now.getTime() + ACCESS_TOKEN_SECONDS * 1_000).toISOString(),
  });
  return exchanged ? { ok: true, accessToken, refreshToken } : { ok: false, error: "invalid_grant" };
}

function renewOAuthAccessToken(parameters: URLSearchParams, authentication?: OAuthClientAuthentication): OAuthTokenExchange {
  if (parameters.has("client_id") && !oneParameter(parameters, "client_id")) return { ok: false, error: "invalid_request" };
  const clientId = oneParameter(parameters, "client_id") ?? authentication?.clientId;
  const refreshToken = oneParameter(parameters, "refresh_token");
  if (!clientId || !refreshToken || !/^[A-Za-z0-9_-]{43}$/u.test(refreshToken)) {
    return { ok: false, error: "invalid_request" };
  }
  const clientFailure = authenticateTokenClient(clientId, authentication);
  if (clientFailure) return clientFailure;
  const scopes = parameters.getAll("scope");
  if (scopes.length > 1) return { ok: false, error: "invalid_request" };
  if (scopes.length === 1 && scopes[0] !== DAILY_LOG_READ_SCOPE) return { ok: false, error: "invalid_scope" };
  const accessToken = opaqueValue();
  const nextRefreshToken = opaqueValue();
  const now = new Date();
  const rotated = rotateOAuthRefreshToken({
    clientId,
    refreshHash: hashValue(refreshToken),
    nextRefreshHash: hashValue(nextRefreshToken),
    accessHash: hashValue(accessToken),
    now: now.toISOString(),
    accessExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_SECONDS * 1_000).toISOString(),
  });
  return rotated
    ? { ok: true, accessToken, refreshToken: nextRefreshToken }
    : { ok: false, error: "invalid_grant" };
}

export function exchangeOAuthToken(parameters: URLSearchParams, authentication?: OAuthClientAuthentication): OAuthTokenExchange {
  if (parameters.has("client_secret")) return { ok: false, error: "invalid_request" };
  switch (oneParameter(parameters, "grant_type")) {
    case "authorization_code": return redeemOAuthAuthorizationCode(parameters, authentication);
    case "refresh_token": return renewOAuthAccessToken(parameters, authentication);
    default: return { ok: false, error: "unsupported_grant_type" };
  }
}

export function connectedDailyLogClients(userId: number) {
  return listOAuthConnections(userId);
}

export function revokeDailyLogClient(userId: number, clientId: string) {
  return revokeOAuthConnection(userId, clientId);
}

export function authenticateDailyLogBearer(header: string | null):
  | { ok: true; userId: number }
  | { ok: false; error: "invalid_token" | "insufficient_scope" } {
  const match = /^Bearer +([A-Za-z0-9_-]{43})$/iu.exec(header ?? "");
  if (!match) return { ok: false, error: "invalid_token" };
  const stored = findOAuthAccessToken(hashValue(match[1]));
  if (!stored || stored.expiresAt <= new Date().toISOString() || stored.accessState !== "active") {
    return { ok: false, error: "invalid_token" };
  }
  if (stored.scope !== DAILY_LOG_READ_SCOPE) return { ok: false, error: "insufficient_scope" };
  return { ok: true, userId: stored.userId };
}
