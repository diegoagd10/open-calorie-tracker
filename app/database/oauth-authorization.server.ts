import { and, eq } from "drizzle-orm";
import { getApplicationDatabase } from "./runtime.server";
import { oauthAccessTokens, oauthAuthorizationCodes, oauthClients, oauthGrants, oauthRefreshTokens, users } from "./schema.server";

export function saveOAuthAuthorizationCode(input: {
  clientId: string;
  userId: number;
  codeHash: string;
  redirectUri: string;
  codeChallenge: string;
  createdAt: string;
  expiresAt: string;
}) {
  getApplicationDatabase().getClient().transaction((transaction) => {
    transaction.insert(oauthGrants).values({
      clientId: input.clientId,
      userId: input.userId,
      scope: "daily-log:read",
      createdAt: input.createdAt,
    }).onConflictDoUpdate({
      target: [oauthGrants.clientId, oauthGrants.userId],
      set: { scope: "daily-log:read" },
    }).run();
    const grant = transaction.select({ id: oauthGrants.id }).from(oauthGrants)
      .where(and(eq(oauthGrants.clientId, input.clientId), eq(oauthGrants.userId, input.userId))).get();
    if (!grant) throw new Error("OAuth grant was not persisted");
    transaction.insert(oauthAuthorizationCodes).values({
      codeHash: input.codeHash,
      grantId: grant.id,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
    }).run();
  });
}

export function exchangeOAuthAuthorizationCode(input: {
  codeHash: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  tokenHash: string;
  refreshHash: string;
  now: string;
  expiresAt: string;
}): boolean {
  return getApplicationDatabase().getClient().transaction((transaction) => {
    const code = transaction.select({
      codeHash: oauthAuthorizationCodes.codeHash,
      grantId: oauthAuthorizationCodes.grantId,
      clientId: oauthGrants.clientId,
      redirectUri: oauthAuthorizationCodes.redirectUri,
      codeChallenge: oauthAuthorizationCodes.codeChallenge,
      codeExpiresAt: oauthAuthorizationCodes.expiresAt,
      accessState: users.accessState,
    }).from(oauthAuthorizationCodes)
      .innerJoin(oauthGrants, eq(oauthAuthorizationCodes.grantId, oauthGrants.id))
      .innerJoin(users, eq(oauthGrants.userId, users.id))
      .where(eq(oauthAuthorizationCodes.codeHash, input.codeHash)).get();
    if (!code || code.clientId !== input.clientId || code.redirectUri !== input.redirectUri ||
        code.codeChallenge !== input.codeChallenge || code.codeExpiresAt <= input.now || code.accessState !== "active") {
      return false;
    }
    transaction.delete(oauthAuthorizationCodes).where(eq(oauthAuthorizationCodes.codeHash, input.codeHash)).run();
    transaction.insert(oauthAccessTokens).values({
      tokenHash: input.tokenHash,
      grantId: code.grantId,
      createdAt: input.now,
      expiresAt: input.expiresAt,
    }).run();
    transaction.insert(oauthRefreshTokens).values({
      tokenHash: input.refreshHash,
      grantId: code.grantId,
      createdAt: input.now,
    }).run();
    return true;
  });
}

export function rotateOAuthRefreshToken(input: {
  clientId: string;
  refreshHash: string;
  nextRefreshHash: string;
  accessHash: string;
  now: string;
  accessExpiresAt: string;
}): boolean {
  return getApplicationDatabase().getClient().transaction((transaction) => {
    const current = transaction.select({
      grantId: oauthRefreshTokens.grantId,
      clientId: oauthGrants.clientId,
      scope: oauthGrants.scope,
      accessState: users.accessState,
      rotatedAt: oauthRefreshTokens.rotatedAt,
    }).from(oauthRefreshTokens)
      .innerJoin(oauthGrants, eq(oauthRefreshTokens.grantId, oauthGrants.id))
      .innerJoin(users, eq(oauthGrants.userId, users.id))
      .where(eq(oauthRefreshTokens.tokenHash, input.refreshHash)).get();
    if (!current || current.clientId !== input.clientId || current.scope !== "daily-log:read" || current.accessState !== "active") {
      return false;
    }
    if (current.rotatedAt) {
      transaction.delete(oauthRefreshTokens).where(eq(oauthRefreshTokens.grantId, current.grantId)).run();
      return false;
    }
    transaction.update(oauthRefreshTokens).set({ rotatedAt: input.now })
      .where(eq(oauthRefreshTokens.tokenHash, input.refreshHash)).run();
    transaction.insert(oauthRefreshTokens).values({
      tokenHash: input.nextRefreshHash,
      grantId: current.grantId,
      createdAt: input.now,
    }).run();
    transaction.insert(oauthAccessTokens).values({
      tokenHash: input.accessHash,
      grantId: current.grantId,
      createdAt: input.now,
      expiresAt: input.accessExpiresAt,
    }).run();
    return true;
  });
}

export function listOAuthConnections(userId: number) {
  return getApplicationDatabase().getClient().select({
    clientId: oauthGrants.clientId,
    name: oauthClients.name,
    scope: oauthGrants.scope,
    connectedAt: oauthGrants.createdAt,
  }).from(oauthGrants)
    .innerJoin(oauthClients, eq(oauthGrants.clientId, oauthClients.id))
    .where(eq(oauthGrants.userId, userId))
    .orderBy(oauthGrants.createdAt, oauthGrants.id).all();
}

export function revokeOAuthConnection(userId: number, clientId: string) {
  return getApplicationDatabase().getClient().transaction((transaction) => {
    const connection = transaction.select({ clientId: oauthGrants.clientId, name: oauthClients.name })
      .from(oauthGrants)
      .innerJoin(oauthClients, eq(oauthGrants.clientId, oauthClients.id))
      .where(and(eq(oauthGrants.userId, userId), eq(oauthGrants.clientId, clientId))).get();
    if (!connection) return undefined;
    transaction.delete(oauthGrants)
      .where(and(eq(oauthGrants.userId, userId), eq(oauthGrants.clientId, clientId))).run();
    return connection;
  });
}

export function findOAuthAccessToken(tokenHash: string) {
  return getApplicationDatabase().getClient().select({
    userId: oauthGrants.userId,
    scope: oauthGrants.scope,
    expiresAt: oauthAccessTokens.expiresAt,
    accessState: users.accessState,
  }).from(oauthAccessTokens)
    .innerJoin(oauthGrants, eq(oauthAccessTokens.grantId, oauthGrants.id))
    .innerJoin(users, eq(oauthGrants.userId, users.id))
    .where(eq(oauthAccessTokens.tokenHash, tokenHash)).get();
}
