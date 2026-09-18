import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Route } from "./+types/key-ceremony";
import {
  authenticatedSessionHeaders,
  getClientIp,
  getSessionForApplicationAccess,
  parseCookies,
  serializeClearedSessionCookie,
  requirePreAuthenticationCsrf,
  requireValidOrigin,
} from "../auth/http.server";
import { KeyAuthenticationError } from "../database/webauthn.server";
import { getAuthenticationService } from "../auth/runtime.server";
import { applicationOrigin, effectiveRequestPolicy } from "../runtime.server";
import { usernameSchema } from "../auth/validation";

const bodySchema = z
  .object({
    action: z.enum([
      "remove-start",
      "remove-finish",
      "disable-start",
      "disable-finish",
      "re-enable-start",
      "re-enable-finish",
      "addition-start",
      "addition-finish",
      "register-start",
      "register-finish",
      "enable-finish",
      "login-start",
      "login-finish",
      "cancel",
    ]),
    csrfToken: z.string().max(128),
    name: z.string().max(80).optional(),
    credentialId: z.string().min(1).max(2048).optional(),
    password: z.string().min(1).max(1024).optional(),
    username: usernameSchema.optional(),
    response: z.unknown().optional(),
  })
  .strict();
const cookieName = "__Host-calorie_key_ceremony";
function ceremonyCookie(value: string) {
  return `${cookieName}=${value}; Path=/; Max-Age=${value ? 300 : 0}; HttpOnly; Secure; SameSite=Strict`;
}
export async function action({ request }: Route.ActionArgs) {
  requireValidOrigin(request);
  // HTTP LAN is never a WebAuthn ceremony origin, including loopback fixtures.
  if (effectiveRequestPolicy().entry === "lan")
    return Response.json(
      {
        error: "Use the public HTTPS address for key sign-in.",
        publicUrl: `${applicationOrigin()}/login`,
      },
      { status: 403 },
    );
  if (Number(request.headers.get("Content-Length") ?? 0) > 32_768)
    throw new Response("Key response too large.", { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) throw new Response("Invalid key request.", { status: 400 });
  const decoder = new TextDecoder();
  let raw = "";
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > 32_768) {
      await reader.cancel();
      throw new Response("Key response too large.", { status: 413 });
    }
    raw += decoder.decode(value, { stream: true });
  }
  raw += decoder.decode();
  let input: z.infer<typeof bodySchema>;
  try {
    input = bodySchema.parse(JSON.parse(raw));
  } catch {
    throw new Response("Invalid key request.", { status: 400 });
  }
  const service = getAuthenticationService();
  const authenticatedAction =
    input.action.startsWith("remove") ||
    input.action.startsWith("disable") ||
    input.action.startsWith("re-enable") ||
    input.action.startsWith("register") ||
    input.action.startsWith("addition") ||
    input.action === "enable-finish";
  const session = authenticatedAction
    ? await getSessionForApplicationAccess(request)
    : undefined;
  if (authenticatedAction) {
    if (!session)
      throw new Response("Sign in before managing keys.", { status: 401 });
    if (!service.verifyCsrfToken(session.token, input.csrfToken))
      throw new Response("CSRF token rejected.", { status: 403 });
  } else if (input.action !== "cancel") {
    requirePreAuthenticationCsrf(request, input.csrfToken);
  } else {
    const signedIn = await getSessionForApplicationAccess(request);
    if (signedIn) {
      if (!service.verifyCsrfToken(signedIn.token, input.csrfToken))
        throw new Response("CSRF token rejected.", { status: 403 });
    } else requirePreAuthenticationCsrf(request, input.csrfToken);
  }
  const starting = input.action.endsWith("start");
  const browser = starting
    ? randomBytes(32).toString("base64url")
    : parseCookies(request.headers.get("Cookie")).get(cookieName);
  if (!browser)
    return Response.json(
      { error: "Key request expired. Retry." },
      { status: 400 },
    );
  const headers = new Headers({ "Cache-Control": "no-store" });
  headers.append(
    "Set-Cookie",
    ceremonyCookie(
      starting ||
        input.action === "register-finish" ||
        input.action === "addition-finish"
        ? browser
        : "",
    ),
  );
  try {
    switch (input.action) {
      case "remove-start":
        return Response.json(
          await service.keys.beginRemoval(
            session!.token,
            browser,
            input.credentialId ?? "",
          ),
          { headers },
        );
      case "remove-finish":
        await service.keys.finishRemoval(
          session!.token,
          browser,
          input.credentialId ?? "",
          input.password ?? input.response,
        );
        headers.append("Set-Cookie", serializeClearedSessionCookie());
        return Response.json({ nextPath: "/login" }, { headers });
      case "disable-start":
      case "re-enable-start":
        return Response.json(
          {
            options: await service.keys.beginModeChange(
              session!.token,
              browser,
              input.action === "re-enable-start",
            ),
          },
          { headers },
        );
      case "disable-finish":
      case "re-enable-finish": {
        const issued = await service.keys.finishModeChange(
          session!.token,
          browser,
          input.action === "re-enable-finish",
          input.response,
        );
        if (issued) {
          for (const cookie of authenticatedSessionHeaders(
            request,
            issued,
          ).getSetCookie())
            headers.append("Set-Cookie", cookie);
        } else headers.append("Set-Cookie", serializeClearedSessionCookie());
        return Response.json(
          { nextPath: issued ? "/settings/security" : "/login" },
          { headers },
        );
      }
      case "addition-start":
        return Response.json(
          {
            options: await service.keys.beginAddition(
              session!.token,
              browser,
              input.name ?? "",
            ),
          },
          { headers },
        );
      case "addition-finish":
        return Response.json(
          {
            options: await service.keys.finishAdditionProof(
              session!.token,
              browser,
              input.response,
            ),
          },
          { headers },
        );
      case "register-start":
        return Response.json(
          {
            options: await service.keys.beginEnrollment(
              session!.token,
              browser,
              input.name ?? "",
            ),
          },
          { headers },
        );
      case "register-finish":
        return Response.json(
          {
            options: await service.keys.finishRegistration(
              session!.token,
              browser,
              input.response,
            ),
          },
          { headers },
        );
      case "login-start":
        return Response.json(
          {
            options: await service.keys.beginLogin(
              input.username ?? "",
              browser,
              getClientIp(request),
            ),
          },
          { headers },
        );
      case "enable-finish":
      case "login-finish": {
        const issued =
          input.action === "enable-finish"
            ? await service.keys.finishEnrollment(
                session!.token,
                browser,
                input.response,
              )
            : await service.keys.finishLogin(browser, input.response);
        const sessionHeaders = authenticatedSessionHeaders(request, issued);
        for (const cookie of sessionHeaders.getSetCookie())
          headers.append("Set-Cookie", cookie);
        return Response.json(
          {
            nextPath: issued.user.passwordChangeRequired
              ? "/account/password"
              : input.action === "enable-finish"
                ? "/settings/security"
                : "/",
          },
          { headers },
        );
      }
      case "cancel":
        service.keys.cancel(browser);
        return Response.json({ cancelled: true }, { headers });
    }
  } catch (error) {
    service.keys.cancel(browser);
    headers.set("Set-Cookie", ceremonyCookie(""));
    return Response.json(
      {
        error:
          error instanceof KeyAuthenticationError
            ? error.message
            : "Key request failed. Retry.",
      },
      {
        headers,
        status:
          error instanceof KeyAuthenticationError &&
          error.message.startsWith("Too many")
            ? 429
            : 400,
      },
    );
  }
}
