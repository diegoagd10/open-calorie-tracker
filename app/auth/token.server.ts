import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export function hashOpaqueToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function deriveCsrfToken(sessionToken: string, purpose: string): string {
  return createHmac("sha256", sessionToken)
    .update(`open-calory-tracker:csrf:${purpose}:v1`, "utf8")
    .digest("base64url");
}

export function safelyEqual(left: string, right: string | undefined): boolean {
  if (!right) return false;

  const expected = Buffer.from(left, "utf8");
  const provided = Buffer.from(right, "utf8");

  return (
    expected.length === provided.length && timingSafeEqual(expected, provided)
  );
}
