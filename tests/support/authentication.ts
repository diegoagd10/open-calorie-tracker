import type {
  AuthenticationService,
  IssuedSession,
} from "../../app/auth/authentication.server";
import { hashPassword } from "../../app/auth/password.server";
import type { ApplicationDatabaseClient } from "../../app/database/database.server";
import {
  passwordCredentials,
  users,
} from "../../app/database/schema.server";

export async function seedAccount(
  database: ApplicationDatabaseClient,
  usernameNormalized: string,
  password: string,
  role: "admin" | "member" = "member",
): Promise<number> {
  const timestamp = "2026-08-29T11:00:00.000Z";
  const passwordHash = await hashPassword(password);
  return database.transaction((transaction) => {
    const user = transaction
      .insert(users)
      .values({
        createdAt: timestamp,
        role,
        usernameNormalized,
      })
      .returning({ id: users.id })
      .get();
    transaction.insert(passwordCredentials).values({
      passwordHash,
      updatedAt: timestamp,
      userId: user.id,
    }).run();
    return user.id;
  });
}

export async function seedAuthenticatedAccount(
  authentication: AuthenticationService,
  database: ApplicationDatabaseClient,
  usernameNormalized: string,
  password: string,
  clientIp: string,
  role: "admin" | "member" = "member",
): Promise<IssuedSession> {
  await seedAccount(database, usernameNormalized, password, role);
  const login = await authentication.login(usernameNormalized, password, clientIp);
  if (!login.ok) throw new Error(`could not authenticate ${usernameNormalized}`);
  return login.session;
}
