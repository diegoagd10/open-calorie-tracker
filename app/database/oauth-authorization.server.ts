import { and, eq } from "drizzle-orm";
import { getApplicationDatabase } from "./runtime.server";
import { oauthAccessTokens, oauthAuthorizationCodes, oauthGrants, users } from "./schema.server";

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
    return true;
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
