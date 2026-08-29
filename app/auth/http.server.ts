import { z } from "zod";

import type {
  AuthenticatedSession,
  IssuedSession,
} from "./authentication.server";
import { getAuthenticationService } from "./runtime.server";

export const SESSION_COOKIE_NAME = "__Host-calorie_session";

const applicationUrlSchema = z.string().url();

function parseCookies(header: string | null): Map<string, string> {
  const cookies = new Map<string, string>();

  for (const entry of header?.split(";") ?? []) {
    const separator = entry.indexOf("=");
    if (separator < 0) continue;

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

export function getSessionToken(request: Request): string | undefined {
  return parseCookies(request.headers.get("Cookie")).get(SESSION_COOKIE_NAME);
}

export function getClientIp(request: Request): string {
  return request.headers.get("X-Open-Calory-Client-IP") ?? "unknown";
}

export async function getAuthenticatedSession(
  request: Request,
): Promise<AuthenticatedSession | undefined> {
  return getAuthenticationService().authenticate(getSessionToken(request));
}

export function serializeSessionCookie(session: IssuedSession): string {
  const maxAgeSeconds = Math.max(
    0,
    Math.floor((session.absoluteExpiresAt.getTime() - Date.now()) / 1_000),
  );

  return [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(session.token)}`,
    "Path=/",
    `Max-Age=${maxAgeSeconds}`,
    `Expires=${session.absoluteExpiresAt.toUTCString()}`,
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

export function serializeClearedSessionCookie(): string {
  return [
    `${SESSION_COOKIE_NAME}=`,
    "Path=/",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "HttpOnly",
    "Secure",
    "SameSite=Lax",
  ].join("; ");
}

export function requireValidOrigin(request: Request): void {
  const fallbackUrl = `http://localhost:${process.env.PORT ?? "3000"}`;
  const applicationUrl = applicationUrlSchema.parse(
    process.env.APPLICATION_URL ?? fallbackUrl,
  );
  const expectedOrigin = new URL(applicationUrl).origin;

  if (request.headers.get("Origin") !== expectedOrigin) {
    throw new Response("Request origin rejected.", { status: 403 });
  }
}
