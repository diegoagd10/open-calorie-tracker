import { randomUUID } from "node:crypto";
import { CredentialSynchronizationError, type ModelRuntime } from "@earendil-works/pi-coding-agent";

type AuthInteraction = Parameters<ModelRuntime["login"]>[2];
type AuthPrompt = Parameters<AuthInteraction["prompt"]>[0];
type AuthEvent = Parameters<AuthInteraction["notify"]>[0];
type ConnectionAttempt = {
  id: string;
  state: "starting" | "waiting" | "disconnecting" | "connected" | "cancelled" | "failed";
  authorizationUrl?: string;
  expiresAt?: string;
  error?: string;
};
type PendingConnection = {
  owner: string;
  view: ConnectionAttempt;
  controller: AbortController;
  done?: Promise<void>;
};

export class PiConnectionConflict extends Error {}

const OPENAI_AUTHORIZATION_ORIGIN = "https://auth.openai.com";
const OPENAI_AUTHORIZATION_PATH = "/oauth/authorize";
const PI_CALLBACK_URL = "http://localhost:1455/auth/callback";

function hasExpectedAuthorizationLocation(url: URL) {
  return url.origin === OPENAI_AUTHORIZATION_ORIGIN
    && url.pathname === OPENAI_AUTHORIZATION_PATH
    && url.username === ""
    && url.password === ""
    && url.hash === "";
}

function hasExpectedAuthorizationParameters(url: URL) {
  return url.searchParams.get("response_type") === "code"
    && url.searchParams.get("redirect_uri") === PI_CALLBACK_URL
    && Boolean(url.searchParams.get("state"))
    && Boolean(url.searchParams.get("code_challenge"));
}

function trustedAuthorizationUrl(value: string) {
  const url = new URL(value);
  if (!hasExpectedAuthorizationLocation(url) || !hasExpectedAuthorizationParameters(url)) {
    throw new Error("Unexpected authorization address");
  }
  return url.toString();
}

/** Instance-wide provider connection; only its initiating session sees the authorization link. */
export class PiConnectionService {
  private runtime?: Promise<ModelRuntime>;
  private attempt?: PendingConnection;

  constructor(
    private readonly authPath: string,
    private readonly provider: string,
  ) {}

  private getRuntime() {
    this.runtime ??= import("@earendil-works/pi-coding-agent")
      .then(({ ModelRuntime }) => ModelRuntime.create({
        authPath: this.authPath,
        modelsPath: null,
        allowModelNetwork: false,
        refreshOnCreate: false,
      }))
      .catch((error: unknown) => {
        this.runtime = undefined;
        throw error;
      });
    return this.runtime;
  }

  private isPending() {
    const state = this.attempt?.view.state;
    return state === "starting" || state === "waiting" || state === "disconnecting";
  }

  async read(owner: string) {
    let connected = false;
    let error: string | undefined;
    try {
      const credentials = await (await this.getRuntime()).listCredentials({ signal: AbortSignal.timeout(5000) });
      connected = credentials.some(credential => credential.providerId === this.provider);
    } catch {
      error = "The saved AI connection could not be read. Check that the application data folder is writable.";
    }
    return {
      supported: this.provider === "openai-codex",
      connected,
      error,
      busy: this.isPending(),
      attempt: this.attempt?.owner === owner ? { ...this.attempt.view } : undefined,
    };
  }

  start(owner: string) {
    if (this.provider !== "openai-codex") {
      throw new PiConnectionConflict("Sign-in here is available for OpenAI Codex only.");
    }
    if (this.isPending()) {
      throw new PiConnectionConflict("A connection change is already in progress. Wait for it to finish.");
    }
    const attempt: PendingConnection = {
      owner,
      view: { id: randomUUID(), state: "starting" },
      controller: new AbortController(),
    };
    this.attempt = attempt;
    attempt.done = this.login(attempt);
  }

  private waitForBrowserCallback(attempt: PendingConnection, promptSignal?: AbortSignal) {
    return new Promise<string>((_resolve, reject) => {
      let settled = false;
      const abort = () => {
        if (settled) return;
        settled = true;
        attempt.controller.signal.removeEventListener("abort", abort);
        promptSignal?.removeEventListener("abort", abort);
        reject(new Error("Browser sign-in cancelled"));
      };
      attempt.controller.signal.addEventListener("abort", abort, { once: true });
      promptSignal?.addEventListener("abort", abort, { once: true });
      if (attempt.controller.signal.aborted || promptSignal?.aborted) abort();
    });
  }

  private answerPrompt(attempt: PendingConnection, prompt: AuthPrompt) {
    if (prompt.type === "select" && prompt.options.some(option => option.id === "browser")) return Promise.resolve("browser");
    if (prompt.type === "manual_code") return this.waitForBrowserCallback(attempt, prompt.signal);
    return Promise.reject(new Error("Browser sign-in unavailable"));
  }

  private publishAuthorizationUrl(attempt: PendingConnection, event: AuthEvent) {
    if (event.type !== "auth_url" || attempt.controller.signal.aborted) return;
    attempt.view = {
      id: attempt.view.id,
      state: "waiting",
      authorizationUrl: trustedAuthorizationUrl(event.url),
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
    };
  }

  private async login(attempt: PendingConnection) {
    const { controller } = attempt;
    const deadline = setTimeout(() => controller.abort("expired"), 15 * 60_000);
    deadline.unref();
    try {
      const runtime = await this.getRuntime();
      await runtime.login(this.provider, "oauth", {
        signal: controller.signal,
        prompt: prompt => this.answerPrompt(attempt, prompt),
        notify: event => this.publishAuthorizationUrl(attempt, event),
      });
      attempt.view = { id: attempt.view.id, state: "connected" };
    } catch (error) {
      if (error instanceof CredentialSynchronizationError) {
        // Pi committed the credentials before its local availability refresh failed.
        attempt.view = { id: attempt.view.id, state: "connected" };
        return;
      }
      attempt.view = {
        id: attempt.view.id,
        state: controller.signal.aborted && controller.signal.reason !== "expired" ? "cancelled" : "failed",
        error: controller.signal.reason === "expired"
          ? "The sign-in link expired. Start again to get a new link."
          : controller.signal.aborted ? undefined
          : "Could not connect to OpenAI. Try the browser authorization again.",
      };
    } finally {
      clearTimeout(deadline);
    }
  }

  async cancel(owner: string, id: string) {
    const attempt = this.attempt;
    if (!attempt || attempt.owner !== owner || attempt.view.id !== id || !this.isPending() || attempt.view.state === "disconnecting") {
      throw new PiConnectionConflict("This sign-in is no longer available. Refresh Settings.");
    }
    attempt.controller.abort();
    await attempt.done;
  }

  async disconnect(owner: string) {
    if (this.isPending()) throw new PiConnectionConflict("Cancel the current sign-in before disconnecting.");
    const attempt: PendingConnection = {
      owner,
      view: { id: randomUUID(), state: "disconnecting" },
      controller: new AbortController(),
    };
    this.attempt = attempt;
    try {
      await (await this.getRuntime()).logout(this.provider, { signal: attempt.controller.signal });
      attempt.view = { id: attempt.view.id, state: "cancelled" };
    } catch (error) {
      attempt.view = error instanceof CredentialSynchronizationError
        ? { id: attempt.view.id, state: "cancelled" }
        : { id: attempt.view.id, state: "failed", error: "Could not remove the saved connection. Try again." };
    }
  }

  shutdown() {
    this.attempt?.controller.abort();
  }
}
