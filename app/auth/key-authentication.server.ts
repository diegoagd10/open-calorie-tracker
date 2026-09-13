import type { AuthenticationResponseJSON } from "@simplewebauthn/server";
import type { ApplicationDatabaseClient } from "../database/database.server";
import {
  WebAuthnStorage,
  KeyAuthenticationError,
  type PendingKeyCeremony,
  type StoredKeyCredential,
  type WebAuthnBoundary,
} from "../database/webauthn.server";
import {
  applicationOrigin,
  enrollmentPreviewEnabled,
  isProductionEnvironment,
} from "../runtime.server";
import { hashOpaqueToken } from "./token.server";
import { prepareIssuedSession } from "./session.server";
import { operationalLog } from "../../server/operational-logging.js";
import {
  keyAssertionResponseSchema,
  keyRegistrationResponseSchema,
} from "./validation";
import { PersistentRateLimiter } from "./rate-limiter.server";

function keyOrigin(): WebAuthnBoundary {
  const url = new URL(applicationOrigin());
  if (
    url.protocol !== "https:" &&
    !(!isProductionEnvironment() && url.hostname === "localhost")
  ) {
    throw new KeyAuthenticationError(
      "Key sign-in requires the public HTTPS address.",
    );
  }
  return { origin: url.origin, rpId: url.hostname };
}
export class KeyAuthenticationService {
  readonly #storage: WebAuthnStorage;
  readonly #now: () => Date;
  readonly #limits: PersistentRateLimiter;
  constructor(database: ApplicationDatabaseClient, now: () => Date) {
    this.#storage = new WebAuthnStorage(database, now);
    this.#now = now;
    this.#limits = new PersistentRateLimiter(database, now);
  }
  async beginEnrollment(token: string, browser: string, name: string) {
    if (!enrollmentPreviewEnabled())
      throw new KeyAuthenticationError(
        "Key enrollment preview is unavailable.",
      );
    const user = this.#storage.enrollmentAccount(hashOpaqueToken(token));
    if (!name.trim() || name.length > 80)
      throw new KeyAuthenticationError("Name your key using 1–80 characters.");
    if (
      !this.#limits.consume("key-enrollment", String(user.id), 10, 15 * 60_000)
    )
      throw new KeyAuthenticationError(
        "Too many key attempts. Try again later.",
      );
    const handle = this.#storage.allocateHandle(
      user.id,
      user.authenticationVersion,
    );
    const boundary = keyOrigin();
    const { generateRegistrationOptions } =
      await import("@simplewebauthn/server");
    const options = await generateRegistrationOptions({
      rpName: "Open Calorie Tracker",
      rpID: boundary.rpId,
      userName: user.usernameNormalized,
      userID: Buffer.from(handle, "base64url"),
      attestationType: "none",
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
      },
    });
    const pending = {
      browserHash: hashOpaqueToken(browser),
      userId: user.id,
      purpose: "register" as const,
      challenge: options.challenge,
      ...boundary,
      authenticationVersion: user.authenticationVersion,
      sessionHash: hashOpaqueToken(token),
      name: name.trim(),
      expiresAt: new Date(this.#now().getTime() + 5 * 60_000).toISOString(),
    };
    this.#storage.save(pending, keyOrigin());
    return options;
  }

  async finishRegistration(token: string, browser: string, response: unknown) {
    const pending = this.#take(
      hashOpaqueToken(browser),
      "register",
      keyOrigin(),
      hashOpaqueToken(token),
    );
    try {
      const registration = keyRegistrationResponseSchema.parse(response);
      const { verifyRegistrationResponse, generateAuthenticationOptions } =
        await import("@simplewebauthn/server");
      const result = await verifyRegistrationResponse({
        response: registration,
        expectedChallenge: pending.challenge,
        expectedOrigin: pending.origin,
        expectedRPID: pending.rpId,
        requireUserPresence: true,
        requireUserVerification: true,
      });
      if (!result.verified)
        throw new KeyAuthenticationError("Registration was not verified.");
      const info = result.registrationInfo;
      const options = await generateAuthenticationOptions({
        rpID: pending.rpId,
        userVerification: "required",
        allowCredentials: [
          { id: info.credential.id, transports: info.credential.transports },
        ],
      });
      const stagedCredential = {
        id: info.credential.id,
        userId: pending.userId,
        publicKey: Buffer.from(info.credential.publicKey).toString("base64url"),
        counter: info.credential.counter,
        revision: 0,
        transports: info.credential.transports ?? [],
        name: pending.name,
        deviceType: info.credentialDeviceType,
        backedUp: info.credentialBackedUp,
        createdAt: this.#now().toISOString(),
        lastUsedAt: this.#now().toISOString(),
      };
      this.#storage.save(
        {
          ...pending,
          purpose: "enable",
          challenge: options.challenge,
          stagedCredential,
        },
        keyOrigin(),
      );
      operationalLog("info", "key_registration", {
        outcome: "verified",
        userId: pending.userId,
      });
      return options;
    } catch {
      operationalLog("info", "key_registration", {
        outcome: "rejected",
        userId: pending.userId,
      });
      throw new KeyAuthenticationError(
        "Key registration failed. Use a FIDO2 key with PIN or biometrics, or Proton Pass, and retry.",
      );
    }
  }
  async beginLogin(username: string, browser: string, clientIp: string) {
    if (
      !this.#limits.consume("key-login", clientIp, 20, 15 * 60_000) ||
      !this.#limits.consume("key-login-account", username, 20, 15 * 60_000)
    )
      throw new KeyAuthenticationError(
        "Too many key attempts. Try again later.",
      );
    const user = this.#storage.accountByUsername(username);
    if (!user || !user.keyLoginEnabled || user.accessState !== "active") {
      operationalLog("info", "key_login", { outcome: "rejected" });
      throw new KeyAuthenticationError(
        "Key sign-in is unavailable for this account.",
      );
    }
    const credentials = this.#storage.credentials(user.id);
    if (!credentials.length)
      throw new KeyAuthenticationError(
        "Key sign-in is unavailable for this account.",
      );
    const boundary = keyOrigin();
    const { generateAuthenticationOptions } =
      await import("@simplewebauthn/server");
    const options = await generateAuthenticationOptions({
      rpID: boundary.rpId,
      userVerification: "required",
      allowCredentials: credentials.map(({ id, transports }) => ({
        id,
        transports,
      })),
    });
    this.#storage.save(
      {
        browserHash: hashOpaqueToken(browser),
        userId: user.id,
        purpose: "login",
        challenge: options.challenge,
        ...boundary,
        authenticationVersion: user.authenticationVersion,
        sessionHash: null,
        stagedCredential: null,
        name: "",
        expiresAt: new Date(this.#now().getTime() + 5 * 60_000).toISOString(),
      },
      keyOrigin(),
    );
    return options;
  }
  finishEnrollment(token: string, browser: string, response: unknown) {
    return this.#assert(browser, "enable", response, token);
  }
  finishLogin(browser: string, response: unknown) {
    return this.#assert(browser, "login", response);
  }
  status(token: string) {
    return this.#storage.status(hashOpaqueToken(token));
  }
  cancel(browser: string): void {
    this.#storage.cancel(hashOpaqueToken(browser));
  }
  #take(
    browserHash: string,
    purpose: PendingKeyCeremony["purpose"],
    boundary: WebAuthnBoundary,
    sessionHash?: string,
  ) {
    try {
      return this.#storage.take(browserHash, purpose, boundary, sessionHash);
    } catch (error) {
      operationalLog(
        "info",
        purpose === "register"
          ? "key_registration"
          : purpose === "enable"
            ? "key_login_policy"
            : "key_login",
        { outcome: "rejected" },
      );
      throw error;
    }
  }
  #credentialForPending(
    pending: PendingKeyCeremony,
    response: AuthenticationResponseJSON,
  ): StoredKeyCredential {
    const credential =
      pending.purpose === "enable"
        ? pending.stagedCredential
        : this.#storage.credential(response.id);
    const user = this.#storage.accountForPending(pending, keyOrigin());
    if (
      !credential ||
      credential.userId !== user.id ||
      credential.id !== response.id
    )
      throw new KeyAuthenticationError("Wrong key owner.");
    if (
      response.response.userHandle &&
      response.response.userHandle !== user.webauthnUserHandle
    )
      throw new KeyAuthenticationError("Wrong key owner.");
    return credential;
  }
  async #assert(
    browser: string,
    purpose: "enable" | "login",
    input: unknown,
    token?: string,
  ) {
    const pending = this.#take(
      hashOpaqueToken(browser),
      purpose,
      keyOrigin(),
      token ? hashOpaqueToken(token) : undefined,
    );
    try {
      const response = keyAssertionResponseSchema.parse(input);
      const credential = this.#credentialForPending(pending, response);
      const { verifyAuthenticationResponse } =
        await import("@simplewebauthn/server");
      const result = await verifyAuthenticationResponse({
        response,
        expectedChallenge: pending.challenge,
        expectedOrigin: pending.origin,
        expectedRPID: pending.rpId,
        requireUserVerification: true,
        credential: {
          id: credential.id,
          publicKey: Buffer.from(credential.publicKey, "base64url"),
          counter: credential.counter,
          transports: credential.transports,
        },
      });
      if (!result.verified)
        throw new KeyAuthenticationError("Key signature rejected.");
      const metadata = {
        counter: result.authenticationInfo.newCounter,
        deviceType: result.authenticationInfo.credentialDeviceType,
        backedUp: result.authenticationInfo.credentialBackedUp,
        lastUsedAt: this.#now().toISOString(),
      };
      const session = this.#storage.complete(
        pending,
        credential,
        metadata,
        keyOrigin(),
        (current, absolute) =>
          prepareIssuedSession(
            this.#now(),
            {
              id: current.id,
              username: current.usernameNormalized,
              role: current.role,
              passwordChangeRequired: current.passwordChangeRequired,
            },
            absolute,
          ),
      );
      operationalLog(
        "info",
        purpose === "enable" ? "key_login_policy" : "key_login",
        { outcome: "succeeded", userId: pending.userId },
      );
      return session;
    } catch {
      operationalLog(
        "info",
        purpose === "enable" ? "key_login_policy" : "key_login",
        { outcome: "rejected", userId: pending.userId },
      );
      throw new KeyAuthenticationError(
        "Key verification failed. Retry with your registered key and its PIN or biometrics.",
      );
    }
  }
}
