import { createHash, randomBytes } from "node:crypto";
import { createOAuthClient, listOAuthClientsForOwner } from "../database/oauth-clients.server";

export type OAuthClientSummary = {
  id: string;
  name: string;
  type: "public" | "confidential";
  redirectUris: string[];
  createdAt: string;
};

export type RegistrationErrors = {
  clientType?: string;
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
      !parsed.hostname || value.includes("*") ||
      parsed.username || parsed.password || parsed.hash
    ) {
      return "Use HTTPS, or HTTP on localhost, 127.0.0.1, or [::1]; omit credentials, fragments, and wildcards.";
    }
    if (result.includes(parsed.href)) return "Redirect URIs must be unique.";
    result.push(parsed.href);
  }
  return result;
}

function validateClientRegistration(input: { clientType: string; name: string; redirectUris: string }):
  | { ok: true; type: "public" | "confidential"; name: string; redirectUris: string[] }
  | { ok: false; errors: RegistrationErrors } {
  const name = input.name.trim();
  const errors: RegistrationErrors = {};
  if (input.clientType !== "public" && input.clientType !== "confidential") errors.clientType = "Choose a public or confidential client.";
  if (!name || name.length > 80 || /[\p{Cc}\p{Cf}]/u.test(name)) {
    errors.name = "Enter a name of 1 to 80 printable characters.";
  }
  const redirectUris = validateRedirectUris(input.redirectUris);
  if (typeof redirectUris === "string") errors.redirectUris = redirectUris;
  if (errors.clientType || errors.name || errors.redirectUris) return { ok: false, errors };
  return { ok: true, type: input.clientType as "public" | "confidential", name, redirectUris: redirectUris as string[] };
}

function present(client: ReturnType<typeof listOAuthClientsForOwner>[number]): OAuthClientSummary {
  return {
    id: client.id,
    name: client.name,
    type: client.type,
    redirectUris: JSON.parse(client.redirectUris) as string[],
    createdAt: client.createdAt,
  };
}

export function registerOAuthClient(ownerId: number, input: { clientType: string; name: string; redirectUris: string }):
  | { ok: true; client: OAuthClientSummary; clientSecret?: string }
  | { ok: false; errors: RegistrationErrors } {
  const validated = validateClientRegistration(input);
  if (!validated.ok) return validated;
  const clientSecret = validated.type === "confidential" ? randomBytes(32).toString("base64url") : undefined;
  const client = createOAuthClient(ownerId, {
    id: randomBytes(24).toString("base64url"),
    name: validated.name,
    type: validated.type,
    secretHash: clientSecret ? createHash("sha256").update(clientSecret, "ascii").digest("hex") : null,
    redirectUris: validated.redirectUris,
  });
  return { ok: true, client: present(client), ...(clientSecret ? { clientSecret } : {}) };
}

export function listOAuthClients(ownerId: number): OAuthClientSummary[] {
  return listOAuthClientsForOwner(ownerId).map(present);
}
