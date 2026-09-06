import { randomUUID } from "node:crypto";
import { CredentialSynchronizationError, type ModelRuntime } from "@earendil-works/pi-coding-agent";

type ConnectionAttempt = {
  id: string;
  state: "starting" | "waiting" | "disconnecting" | "connected" | "cancelled" | "failed";
  userCode?: string;
  verificationUri?: string;
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

/** Instance-wide provider connection; only its initiating session sees the code. */
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

  private async login(attempt: PendingConnection) {
    const { controller } = attempt;
    const deadline = setTimeout(() => controller.abort("expired"), 15 * 60_000);
    deadline.unref();
    try {
      const runtime = await this.getRuntime();
      await runtime.login(this.provider, "oauth", {
        signal: controller.signal,
        prompt: async prompt => {
          if (prompt.type === "select" && prompt.options.some(option => option.id === "device_code")) {
            return "device_code";
          }
          throw new Error("Device sign-in unavailable");
        },
        notify: event => {
          if (event.type !== "device_code" || controller.signal.aborted) return;
          // The only supported flow is OpenAI's device page, never an arbitrary redirect.
          if (event.verificationUri !== "https://auth.openai.com/codex/device") {
            throw new Error("Unexpected verification address");
          }
          attempt.view = {
            id: attempt.view.id,
            state: "waiting",
            userCode: event.userCode,
            verificationUri: event.verificationUri,
            expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
          };
        },
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
          ? "The sign-in code expired. Start again to get a new code."
          : controller.signal.aborted ? undefined
          : "Could not connect to OpenAI. Try again and make sure device code login is enabled in your ChatGPT security settings.",
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
