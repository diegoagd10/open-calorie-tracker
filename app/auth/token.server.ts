import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export function hashOpaqueToken(token: string): string {
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
