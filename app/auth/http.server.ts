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
import { effectiveRequestPolicy } from "../runtime.server";

function cookiePolicy() {
  return effectiveRequestPolicy().entry === "lan"
    ? {
        sessionName: "calorie_lan_session",
        csrfName: "calorie_lan_auth_csrf",
        secure: false,
      }
    : {
        sessionName: "__Host-calorie_session",
        csrfName: "__Host-calorie_auth_csrf",
        secure: true,
      };
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
  return parseCookies(request.headers.get("Cookie")).get(
    cookiePolicy().sessionName,
  );
}

function getPreAuthenticationCsrfToken(request: Request): string | undefined {
  return parseCookies(request.headers.get("Cookie")).get(
    cookiePolicy().csrfName,
  );
}

export function getClientIp(request: Request): string {
  return request.headers.get("X-Open-Calory-Client-IP") ?? "unknown";
}

async function authenticateRequest(
  request: Request,
): Promise<AuthenticatedSession | undefined> {
  return getAuthenticationService().authenticate(getSessionToken(request));
}

export function getSessionForAccountAccess(
  request: Request,
): Promise<AuthenticatedSession | undefined> {
  return authenticateRequest(request);
}

export async function getSessionForApplicationAccess(
  request: Request,
): Promise<AuthenticatedSession | undefined> {
  const session = await authenticateRequest(request);
  if (session?.user.passwordChangeRequired) {
    throw redirect("/account/password");
  }
  return session;
}

export async function requireApplicationSession(
  request: Request,
): Promise<AuthenticatedSession> {
  const session = await getSessionForApplicationAccess(request);
  if (!session) throw redirect("/login");
  return session;
}

export async function requireAdministratorSession(
  request: Request,
): Promise<AuthenticatedSession> {
  const session = await requireApplicationSession(request);
  if (session.user.role !== "admin") {
    throw new Response("Not Found", { status: 404 });
  }
  return session;
}

export function serializeSessionCookie(session: IssuedSession): string {
  return serializeEntryCookie(
    cookiePolicy().sessionName,
    session.token,
    session.absoluteExpiresAt,
  );
}

export function serializeClearedSessionCookie(): string {
  return serializeEntryCookie(cookiePolicy().sessionName, "", new Date(0));
}

function serializeEntryCookie(
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
    ...(cookiePolicy().secure ? ["Secure"] : []),
    "SameSite=Lax",
  ].join("; ");
}

function serializePreAuthenticationCsrfCookie(
  session: PreAuthenticationCsrfSession,
): string {
  return serializeEntryCookie(
    cookiePolicy().csrfName,
    session.token,
    session.expiresAt,
  );
}

function serializeClearedPreAuthenticationCsrfCookie(): string {
  return serializeEntryCookie(cookiePolicy().csrfName, "", new Date(0));
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
  headers.append("Set-Cookie", serializeClearedPreAuthenticationCsrfCookie());
  return headers;
}

export function requireValidOrigin(request: Request): void {
  if (request.headers.get("Origin") !== effectiveRequestPolicy().origin) {
    throw new Response("Request origin rejected.", { status: 403 });
  }
}


export async function getApplicationMutationSession(request: Request): Promise<AuthenticatedSession | Response> {
  requireValidOrigin(request);
  const session = await getSessionForApplicationAccess(request);
  return session ?? redirect("/login", { headers: { "Set-Cookie": serializeClearedSessionCookie() } });
}
export async function readApplicationMutationForm(request: Request, session: AuthenticatedSession): Promise<FormData> {
  let form: FormData;
  try {
    form = await request.formData();
  } catch (error) {
    // A wrong content type or malformed multipart body is not a form any page sends.
    if (error instanceof TypeError) throw new Response("The form could not be read.", { status: 400 });
    throw error;
  }
  if (!getAuthenticationService().verifyCsrfToken(session.token, String(form.get("csrfToken") ?? ""))) {
    throw new Response("CSRF token rejected.", { status: 403 });
  }
  return form;
}
