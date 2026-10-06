import { getClientIp } from "../auth/http.server";
import type { ApiKeyScope } from "./presets";
import { getApiKeyAuthenticator } from "./runtime.server";

/** Headers on every REST API response: never cached, never leaked through a referrer. */
export const privateHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

/** A REST API error: a `snake_case` code in a private JSON body. */
export function apiError(error: string, status: number, headers: Record<string, string> = {}) {
  return Response.json({ error }, { status, headers: { ...privateHeaders, ...headers } });
}

/**
 * The account behind the request's API key when the key holds `requiredScope`, or the
 * refusal to send: `401`, `403`, or `429` with the realm's `WWW-Authenticate` challenge.
 */
export function authenticateApiRequest(
  request: Request,
  realm: string,
  requiredScope: ApiKeyScope,
): { userId: number } | Response {
  const caller = getApiKeyAuthenticator().authenticate(request.headers.get("Authorization"), getClientIp(request), requiredScope);
  if (caller.ok) return { userId: caller.userId };
  if (caller.error === "rate_limited") return apiError("rate_limited", 429, { "Retry-After": String(caller.retryAfterSeconds) });
  return caller.error === "insufficient_scope"
    ? apiError("insufficient_scope", 403, { "WWW-Authenticate": `Bearer realm="${realm}", error="insufficient_scope", scope="${requiredScope}"` })
    : apiError("invalid_token", 401, { "WWW-Authenticate": `Bearer realm="${realm}", error="invalid_token"` });
}

/** A REST write body is a few hundred bytes; 16 KiB leaves room for client metadata. */
const MAX_BODY_BYTES = 16 * 1024;

/** Thrown while reading a body past `MAX_BODY_BYTES`, so nothing larger is buffered. */
export class BodyTooLargeError extends Error {}

/** The body as text, counting received bytes rather than trusting `Content-Length`. */
async function readBoundedText(request: Request): Promise<string> {
  if (Number(request.headers.get("Content-Length") ?? 0) > MAX_BODY_BYTES) {
    await request.body?.cancel();
    throw new BodyTooLargeError();
  }
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new BodyTooLargeError();
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/** The parsed JSON body, or undefined when it is not JSON. */
export async function readJson(request: Request): Promise<unknown> {
  const text = await readBoundedText(request);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
