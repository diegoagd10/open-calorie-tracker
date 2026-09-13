import { randomBytes } from "node:crypto";
import { and, eq, lte } from "drizzle-orm";
import type { ApplicationDatabaseClient } from "./database.server";
import {
  sessions,
  users,
  webauthnCeremonies,
  webauthnCredentials,
} from "./schema.server";
import { findActiveSessionByTokenHash } from "./credential-sessions.server";
import { isAccountSetupComplete } from "./account-setup.server";

export class KeyAuthenticationError extends Error {}
export type PendingKeyCeremony = typeof webauthnCeremonies.$inferSelect;
export type StoredKeyCredential = typeof webauthnCredentials.$inferSelect;
export type VerifiedKeyAssertion = {
  credential: StoredKeyCredential;
  metadata: Pick<
    StoredKeyCredential,
    "counter" | "deviceType" | "backedUp" | "lastUsedAt"
  >;
};
export type WebAuthnBoundary = { origin: string; rpId: string };
export class WebAuthnStorage {
  constructor(
    readonly database: ApplicationDatabaseClient,
    readonly now: () => Date,
  ) {}
  accountByUsername(username: string) {
    return this.database
      .select()
      .from(users)
      .where(eq(users.usernameNormalized, username))
      .get();
  }
  credentials(userId: number) {
    return this.database
      .select()
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.userId, userId))
      .all();
  }
  credential(id: string) {
    return this.database
      .select()
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.id, id))
      .get();
  }
  session(hash: string) {
    const session = findActiveSessionByTokenHash(this.database, hash);
    if (
      !session ||
      new Date(session.idleExpiresAt) <= this.now() ||
      new Date(session.absoluteExpiresAt) <= this.now()
    )
      throw new KeyAuthenticationError("Sign in again and retry.");
    return session;
  }
  enrollmentAccount(sessionHash: string) {
    const session = this.session(sessionHash);
    if (
      session.passwordChangeRequired ||
      !isAccountSetupComplete(this.database, session.userId)
    )
      throw new KeyAuthenticationError(
        "Complete account setup before enrolling a key.",
      );
    const user = this.database
      .select()
      .from(users)
      .where(eq(users.id, session.userId))
      .get()!;
    return user;
  }
  allocateHandle(userId: number, version: number) {
    return this.database.transaction(
      (tx) => {
        const current = tx
          .select()
          .from(users)
          .where(eq(users.id, userId))
          .get();
        if (!current || current.authenticationVersion !== version)
          throw new KeyAuthenticationError(
            "Account changed. Retry enrollment.",
          );
        const handle =
          current.webauthnUserHandle ?? randomBytes(32).toString("base64url");
        tx.update(users)
          .set({ webauthnUserHandle: handle })
          .where(eq(users.id, userId))
          .run();
        return handle;
      },
      { behavior: "immediate" },
    );
  }
  accountForPending(pending: PendingKeyCeremony, boundary: WebAuthnBoundary) {
    const user = this.database
      .select()
      .from(users)
      .where(eq(users.id, pending.userId))
      .get();
    if (
      !user ||
      user.accessState !== "active" ||
      user.authenticationVersion !== pending.authenticationVersion ||
      (["login", "add-proof", "register-add", "add"].includes(pending.purpose)
        ? !user.keyLoginEnabled
        : user.keyLoginEnabled)
    )
      throw new KeyAuthenticationError(
        "Account or sign-in policy changed. Retry.",
      );
    this.#validateBoundary(pending, boundary);
    this.#validateEnrollmentSession(pending, user.id);
    return user;
  }
  #validateEnrollmentSession(pending: PendingKeyCeremony, userId: number) {
    if (pending.sessionHash) {
      const session = this.session(pending.sessionHash);
      if (
        session.userId !== userId ||
        session.passwordChangeRequired ||
        !isAccountSetupComplete(this.database, userId)
      )
        throw new KeyAuthenticationError(
          "Complete account setup before enrolling a key.",
        );
    }
  }
  #validateBoundary(pending: PendingKeyCeremony, boundary: WebAuthnBoundary) {
    if (
      new Date(pending.expiresAt) <= this.now() ||
      boundary.origin !== pending.origin ||
      boundary.rpId !== pending.rpId
    )
      throw new KeyAuthenticationError(
        "Key request expired or its public address changed. Retry.",
      );
  }
  save(
    pending: typeof webauthnCeremonies.$inferInsert,
    boundary: WebAuthnBoundary,
    previous?: PendingKeyCeremony,
  ) {
    this.database.transaction(
      (tx) => {
        if (previous) this.#requireProcessing(previous);
        this.accountForPending(
          {
            ...pending,
            sessionHash: pending.sessionHash ?? null,
            stagedCredential: pending.stagedCredential ?? null,
          },
          boundary,
        );
        tx.delete(webauthnCeremonies)
          .where(lte(webauthnCeremonies.expiresAt, this.now().toISOString()))
          .run();
        const values = {
          ...pending,
          sessionHash: pending.sessionHash ?? null,
          stagedCredential: pending.stagedCredential ?? null,
        };
        tx.insert(webauthnCeremonies)
          .values(values)
          .onConflictDoUpdate({
            target: webauthnCeremonies.browserHash,
            set: values,
          })
          .run();
      },
      { behavior: "immediate" },
    );
  }
  cancel(browserHash: string): void {
    this.database
      .delete(webauthnCeremonies)
      .where(eq(webauthnCeremonies.browserHash, browserHash))
      .run();
  }
  take(
    browserHash: string,
    purpose: PendingKeyCeremony["purpose"] | PendingKeyCeremony["purpose"][],
    boundary: WebAuthnBoundary,
    sessionHash?: string,
  ) {
    // Mark before async crypto: failed/replayed submissions cannot reuse a challenge,
    // while cancellation or a newer ceremony can still invalidate the in-flight result.
    const pending = this.database.transaction(
      (tx) => {
        const current = tx
          .select()
          .from(webauthnCeremonies)
          .where(eq(webauthnCeremonies.browserHash, browserHash))
          .get();
        if (current?.purpose === "processing") return undefined;
        if (current)
          tx.update(webauthnCeremonies)
            .set({ purpose: "processing" })
            .where(eq(webauthnCeremonies.browserHash, browserHash))
            .run();
        return current;
      },
      { behavior: "immediate" },
    );
    if (
      !pending ||
      !(Array.isArray(purpose) ? purpose : [purpose]).includes(
        pending.purpose,
      ) ||
      (pending.sessionHash && pending.sessionHash !== sessionHash)
    )
      throw new KeyAuthenticationError(
        "Key request expired or was already used. Retry.",
      );
    this.accountForPending(pending, boundary);
    return pending;
  }
  status(sessionHash: string) {
    const session = this.session(sessionHash);
    const user = this.database
      .select()
      .from(users)
      .where(eq(users.id, session.userId))
      .get()!;
    return {
      enabled: user.keyLoginEnabled,
      credentials: this.credentials(user.id).map(({ id, name, createdAt }) => ({
        id,
        name,
        createdAt,
      })),
    };
  }
  #requireProcessing(pending: PendingKeyCeremony) {
    const current = this.database
      .select()
      .from(webauthnCeremonies)
      .where(eq(webauthnCeremonies.browserHash, pending.browserHash))
      .get();
    if (
      !current ||
      current.purpose !== "processing" ||
      current.challenge !== pending.challenge
    )
      throw new KeyAuthenticationError(
        "Key request was cancelled or superseded. Retry.",
      );
  }
  #updateCredential(verified: VerifiedKeyAssertion) {
    const { credential, metadata } = verified;
    const updated = this.database
      .update(webauthnCredentials)
      .set({ ...metadata, revision: credential.revision + 1 })
      .where(
        and(
          eq(webauthnCredentials.id, credential.id),
          eq(webauthnCredentials.userId, credential.userId),
          eq(webauthnCredentials.revision, credential.revision),
        ),
      )
      .returning({ id: webauthnCredentials.id })
      .get();
    if (!updated)
      throw new KeyAuthenticationError("Key changed during sign-in. Retry.");
  }
  authorizeAddition(
    pending: PendingKeyCeremony,
    verified: VerifiedKeyAssertion,
    challenge: string,
    boundary: WebAuthnBoundary,
  ) {
    const { credential } = verified;
    this.database.transaction(
      () => {
        const current = this.accountForPending(pending, boundary);
        if (pending.purpose !== "add-proof" || credential.userId !== current.id)
          throw new KeyAuthenticationError("Wrong key owner or action.");
        this.#updateCredential(verified);
        // This browser/session-bound registration challenge is the single-use addition authorization.
        // Keep the original expiry so later prompts cannot extend the freshness window.
        this.save(
          { ...pending, purpose: "register-add", challenge },
          boundary,
          pending,
        );
      },
      { behavior: "immediate" },
    );
  }
  complete<T>(
    pending: PendingKeyCeremony,
    verified: VerifiedKeyAssertion,
    boundary: WebAuthnBoundary,
    issue: (
      user: typeof users.$inferSelect,
      absolute?: Date,
    ) => { persisted: typeof sessions.$inferInsert; session: T },
  ): T {
    const { credential, metadata } = verified;
    return this.database.transaction(
      (tx) => {
        this.#requireProcessing(pending);
        const current = this.accountForPending(pending, boundary);
        if (credential.userId !== current.id)
          throw new KeyAuthenticationError("Wrong key owner.");
        const absolute = pending.sessionHash
          ? new Date(this.session(pending.sessionHash).absoluteExpiresAt)
          : undefined;
        const issued = issue(current, absolute);
        if (pending.stagedCredential) {
          if (
            tx
              .select({ id: webauthnCredentials.id })
              .from(webauthnCredentials)
              .where(eq(webauthnCredentials.id, credential.id))
              .get()
          )
            throw new KeyAuthenticationError("Key already registered.");
          tx.insert(webauthnCredentials)
            .values({ ...credential, ...metadata })
            .run();
          if (pending.purpose === "enable") {
            tx.update(users)
              .set({
                keyLoginEnabled: true,
                authenticationVersion: current.authenticationVersion + 1,
              })
              .where(eq(users.id, current.id))
              .run();
            tx.delete(sessions).where(eq(sessions.userId, current.id)).run();
            tx.delete(webauthnCeremonies)
              .where(eq(webauthnCeremonies.userId, current.id))
              .run();
          }
        } else {
          this.#updateCredential(verified);
        }
        tx.delete(webauthnCeremonies)
          .where(eq(webauthnCeremonies.browserHash, pending.browserHash))
          .run();
        tx.insert(sessions).values(issued.persisted).run();
        return issued.session;
      },
      { behavior: "immediate" },
    );
  }
}
