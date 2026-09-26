import { and, eq } from "drizzle-orm";
import { getApplicationDatabase } from "./runtime.server";
import { oauthClients } from "./schema.server";

export function createOAuthClient(ownerId: number, input: { id: string; name: string; redirectUris: string[] }) {
  return getApplicationDatabase().getClient().insert(oauthClients).values({
    id: input.id,
    ownerId,
    name: input.name,
    type: "public",
    redirectUris: JSON.stringify(input.redirectUris),
    createdAt: new Date().toISOString(),
  }).returning().get();
}

export function listOAuthClientsForOwner(ownerId: number) {
  return getApplicationDatabase().getClient().select().from(oauthClients)
    .where(and(eq(oauthClients.ownerId, ownerId), eq(oauthClients.type, "public")))
    .orderBy(oauthClients.createdAt)
    .all();
}

export function findOAuthClient(clientId: string) {
  return getApplicationDatabase().getClient().select().from(oauthClients)
    .where(eq(oauthClients.id, clientId)).get();
}
