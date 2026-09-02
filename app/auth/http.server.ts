import type {
  AuthenticatedSession,
  IssuedSession,
} from "./authentication.server";
import type { PreAuthenticationCsrfSession } from "./pre-authentication-csrf.server";
import { redirect } from "react-router";
import {
  getAuthenticationService,
  getPreAuthenticationCsrfService,
} from "./runtime.server";
import { applicationOrigin } from "../runtime.server";

function sessionCookieName(): string {
  return "__Host-calorie_session";
}

function preAuthenticationCsrfCookieName(): string {
  return "__Host-calorie_auth_csrf";
}

export function parseCookies(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>();
  if (header === null) return cookies;

  for (const entry of header.split(";")) {
    const separator = entry.indexOf("=");
    if (separator <= 0) continue;

    const name = entry.slice(0, separator).trim();
    const value = entry.slice(separator + 1).trim();
    try {
      cookies.set(name, decodeURIComponent(value));
    } catch {
      // Ignore malformed cookie values at this external boundary.
    }
  }

  return cookies;
}

function getSessionToken(request: Request): string | undefined {
  return parseCookies(request.headers.get("Cookie")).get(sessionCookieName());
}

function getPreAuthenticationCsrfToken(request: Request): string | undefined {
  return parseCookies(request.headers.get("Cookie")).get(
    preAuthenticationCsrfCookieName(),
  );
}

export function getClientIp(request: Request): string {
  return request.headers.get("X-Open-Calory-Client-IP") ?? "unknown";
}

export async function getAuthenticatedSession(
  request: Request,
): Promise<AuthenticatedSession | undefined> {
  return getAuthenticationService().authenticate(getSessionToken(request));
}

export async function requireAdministratorSession(
  request: Request,
): Promise<AuthenticatedSession> {
  const session = await getAuthenticatedSession(request);
  if (!session) throw redirect("/login");
  requireCompletedPasswordOnboarding(session);
  if (session.user.role !== "admin") {
    throw new Response("Not Found", { status: 404 });
  }
  return session;
}

export function requireCompletedPasswordOnboarding(
  session: AuthenticatedSession,
): void {
  if (session.user.passwordChangeRequired) {
    throw redirect("/account/password");
  }
}

export function serializeSessionCookie(session: IssuedSession): string {
  return serializeHostCookie(
    sessionCookieName(),
    session.token,
    session.absoluteExpiresAt,
  );
}

export function serializeClearedSessionCookie(): string {
  return serializeHostCookie(sessionCookieName(), "", new Date(0));
}

function serializeHostCookie(
  name: string,
  value: string,
  expiresAt: Date,
): string {
  const maxAgeSeconds = Math.max(
    0,
    Math.floor((expiresAt.getTime() - Date.now()) / 1_000),
  );

  return [
    `${name}=${encodeURIComponent(value)}`,
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
    `Expires=${expiresAt.toUTCString()}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

function serializePreAuthenticationCsrfCookie(
  session: PreAuthenticationCsrfSession,
): string {
  return serializeHostCookie(
    preAuthenticationCsrfCookieName(),
    session.token,
    session.expiresAt,
  );
}

function serializeClearedPreAuthenticationCsrfCookie(): string {
  return serializeHostCookie(
    preAuthenticationCsrfCookieName(),
    "",
    new Date(0),
  );
}

export function loadPreAuthenticationCsrf(request: Request): {
  csrfToken: string;
  headers?: Headers;
} {
  const service = getPreAuthenticationCsrfService();
  const current = service.resolve(getPreAuthenticationCsrfToken(request));
  if (current) return { csrfToken: current.csrfToken };

  const issued = service.issue();
  const headers = new Headers();
  headers.append("Set-Cookie", serializePreAuthenticationCsrfCookie(issued));
  return { csrfToken: issued.csrfToken, headers };
}

export function requirePreAuthenticationCsrf(
  request: Request,
  candidate: string | undefined,
): void {
  const token = getPreAuthenticationCsrfToken(request);
  if (!getPreAuthenticationCsrfService().verify(token, candidate)) {
    throw new Response("CSRF token rejected.", { status: 403 });
  }
}

export function authenticatedSessionHeaders(
  request: Request,
  session: IssuedSession,
): Headers {
  const preAuthenticationToken = getPreAuthenticationCsrfToken(request);
  getPreAuthenticationCsrfService().revoke(preAuthenticationToken);

  const headers = new Headers();
  headers.append("Set-Cookie", serializeSessionCookie(session));
  headers.append(
    "Set-Cookie",
    serializeClearedPreAuthenticationCsrfCookie(),
  );
  return headers;
}

export function requireValidOrigin(request: Request): void {
  if (request.headers.get("Origin") !== applicationOrigin()) {
    throw new Response("Request origin rejected.", { status: 403 });
  }
}
