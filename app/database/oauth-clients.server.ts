import { eq } from "drizzle-orm";
import { getApplicationDatabase } from "./runtime.server";
import { oauthClients } from "./schema.server";

export function createOAuthClient(ownerId: number, input: { id: string; name: string; type: "public" | "confidential"; secretHash: string | null; redirectUris: string[] }) {
  return getApplicationDatabase().getClient().insert(oauthClients).values({
    id: input.id,
    ownerId,
    name: input.name,
    type: input.type,
    secretHash: input.secretHash,
    redirectUris: JSON.stringify(input.redirectUris),
    createdAt: new Date().toISOString(),
  }).returning().get();
}

export function listOAuthClientsForOwner(ownerId: number) {
  return getApplicationDatabase().getClient().select({
    id: oauthClients.id,
    name: oauthClients.name,
    type: oauthClients.type,
    redirectUris: oauthClients.redirectUris,
    createdAt: oauthClients.createdAt,
  }).from(oauthClients)
    .where(eq(oauthClients.ownerId, ownerId))
    .orderBy(oauthClients.createdAt)
    .all();
}

export function findOAuthClient(clientId: string) {
  return getApplicationDatabase().getClient().select().from(oauthClients)
    .where(eq(oauthClients.id, clientId)).get();
}
