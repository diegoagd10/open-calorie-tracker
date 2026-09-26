import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getApplicationDatabase } from "../database/runtime.server";
import { oauthClients } from "../database/schema.server";

export type PublicOAuthClient = {
  id: string;
  name: string;
  type: "public";
  redirectUris: string[];
  createdAt: string;
};

export type RegistrationErrors = {
  name?: string;
  redirectUris?: string;
};

function validateRedirectUris(input: string): string[] | string {
  if (input.length > 20_480) return "Enter no more than ten redirect URIs.";
  const lines = input.split(/\r?\n/u).filter((line) => line !== "");
  if (lines.length === 0 || lines.length > 10) return "Enter one to ten redirect URIs, one per line.";
  const result: string[] = [];
  for (const value of lines) {
    if (value.length > 2_048 || value !== value.trim() || /\s/u.test(value)) {
      return "Each redirect URI must be a complete address without spaces.";
    }
    let parsed: URL;
    try {
      parsed = new URL(value);
    } catch {
      return "Each redirect URI must be a complete address.";
    }
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname);
    if (
      (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) ||
      !parsed.hostname || parsed.hostname.includes("*") ||
      parsed.username || parsed.password || parsed.hash
    ) {
      return "Use HTTPS, or HTTP on localhost, 127.0.0.1, or [::1]; omit credentials, fragments, and wildcards.";
    }
    if (result.includes(parsed.href)) return "Redirect URIs must be unique.";
    result.push(parsed.href);
  }
  return result;
}

export function validatePublicClientRegistration(input: { name: string; redirectUris: string }):
  | { ok: true; name: string; redirectUris: string[] }
  | { ok: false; errors: RegistrationErrors } {
  const name = input.name.trim();
  const errors: RegistrationErrors = {};
  if (!name || name.length > 80 || /[\p{Cc}\p{Cf}]/u.test(name)) {
    errors.name = "Enter a name of 1 to 80 printable characters.";
  }
  const redirectUris = validateRedirectUris(input.redirectUris);
  if (typeof redirectUris === "string") errors.redirectUris = redirectUris;
  if (errors.name || errors.redirectUris) return { ok: false, errors };
  return { ok: true, name, redirectUris: redirectUris as string[] };
}

function present(client: typeof oauthClients.$inferSelect): PublicOAuthClient {
  return {
    id: client.id,
    name: client.name,
    type: "public",
    redirectUris: JSON.parse(client.redirectUris) as string[],
    createdAt: client.createdAt,
  };
}

export function registerPublicClient(ownerId: number, input: { name: string; redirectUris: string[] }): PublicOAuthClient {
  const client = getApplicationDatabase().getClient().insert(oauthClients).values({
    id: randomBytes(24).toString("base64url"),
    ownerId,
    name: input.name,
    type: "public",
    redirectUris: JSON.stringify(input.redirectUris),
    createdAt: new Date().toISOString(),
  }).returning().get();
  return present(client);
}

export function listPublicClients(ownerId: number): PublicOAuthClient[] {
  return getApplicationDatabase().getClient().select().from(oauthClients)
    .where(and(eq(oauthClients.ownerId, ownerId), eq(oauthClients.type, "public")))
    .orderBy(oauthClients.createdAt)
    .all().map(present);
}
