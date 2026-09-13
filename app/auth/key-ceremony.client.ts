import {
  WebAuthnAbortService,
  startAuthentication,
  startRegistration,
} from "@simplewebauthn/browser";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";

let activePrompt: AbortController | undefined;

async function post<T>(
  csrfToken: string,
  action: string,
  fields: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch("/key-ceremony", {
    signal: action === "cancel" ? undefined : activePrompt?.signal,
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, csrfToken, ...fields }),
  });
  const result = (await response.json().catch(() => ({ error: "Key request failed. Retry." }))) as T & { error?: string };
  if (!response.ok)
    throw new Error(result.error ?? "Key request failed. Retry.");
  return result;
}
export async function enrollKey(csrf: string, name: string) {
  activePrompt = new AbortController();
  const prompt = activePrompt;
  try {
    const registration = await post<{
      options: PublicKeyCredentialCreationOptionsJSON;
    }>(csrf, "register-start", { name });
    prompt.signal.throwIfAborted();
    const response = await startRegistration({
      optionsJSON: registration.options,
    });
    const verification = await post<{
      options: PublicKeyCredentialRequestOptionsJSON;
    }>(csrf, "register-finish", { response });
    prompt.signal.throwIfAborted();
    const assertion = await startAuthentication({
      optionsJSON: verification.options,
    });
    return await post<{ nextPath: string }>(csrf, "enable-finish", {
      response: assertion,
    });
  } catch (error) {
    await post(csrf, "cancel").catch(() => {});
    throw error;
  }
}
export async function signInWithKey(csrf: string, username: string) {
  activePrompt = new AbortController();
  const prompt = activePrompt;
  try {
    const verification = await post<{
      options: PublicKeyCredentialRequestOptionsJSON;
    }>(csrf, "login-start", { username });
    prompt.signal.throwIfAborted();
    const response = await startAuthentication({
      optionsJSON: verification.options,
    });
    return await post<{ nextPath: string }>(csrf, "login-finish", { response });
  } catch (error) {
    await post(csrf, "cancel").catch(() => {});
    throw error;
  }
}
export function cancelKeyPrompt(): void {
  activePrompt?.abort();
  WebAuthnAbortService.cancelCeremony();
}

export function keyProviderError(error: unknown): string {
  if (
    error instanceof Error &&
    (error.name === "NotAllowedError" ||
      error.name === "WebAuthnError" ||
      error.name === "AbortError")
  )
    return "The key prompt was cancelled or your provider could not verify you. Retry with a FIDO2 key with PIN or biometrics, or Proton Pass.";
  return error instanceof Error
    ? error.message
    : "Your key provider is unavailable. Retry.";
}
