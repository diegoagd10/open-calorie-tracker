import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export function hashOpaqueToken(token: string): string {
  // Session and pre-authentication tokens are random, high-entropy identifiers,
  // not user passwords; SHA-256 intentionally avoids storing the bearer value.
  // codeql[js/insufficient-password-hash]
  return createHash("sha256").update(token).digest("hex");
}

export function deriveCsrfToken(sessionToken: string, purpose: string): string {
  return createHmac("sha256", sessionToken)
    .update(`open-calory-tracker:csrf:${purpose}:v1`)
    .digest("base64url");
}

export function safelyEqual(left: string, right: string | undefined): boolean {
  if (!right) return false;

  const expected = Buffer.from(left);
  const provided = Buffer.from(right);

  return (
    expected.length === provided.length && timingSafeEqual(expected, provided)
  );
}
