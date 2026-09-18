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
  const result = (await response
    .json()
    .catch(() => ({ error: "Key request failed. Retry." }))) as T & {
    error?: string;
  };
  if (!response.ok)
    throw new Error(result.error ?? "Key request failed. Retry.");
  return result;
}
export async function enrollKey(csrf: string, name: string, enabled = false) {
  activePrompt = new AbortController();
  const prompt = activePrompt;
  try {
    let registration: { options: PublicKeyCredentialCreationOptionsJSON };
    if (enabled) {
      const proof = await post<{
        options: PublicKeyCredentialRequestOptionsJSON;
      }>(csrf, "addition-start", { name });
      prompt.signal.throwIfAborted();
      const response = await startAuthentication({
        optionsJSON: proof.options,
      });
      registration = await post(csrf, "addition-finish", { response });
    } else {
      registration = await post(csrf, "register-start", { name });
    }
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
export async function changeKeyLoginMode(csrf: string, enabled: boolean) {
  activePrompt = new AbortController();
  const prompt = activePrompt;
  const action = enabled ? "re-enable" : "disable";
  try {
    const verification = await post<{
      options: PublicKeyCredentialRequestOptionsJSON;
    }>(csrf, `${action}-start`);
    prompt.signal.throwIfAborted();
    const response = await startAuthentication({
      optionsJSON: verification.options,
    });
    return await post<{ nextPath: string }>(csrf, `${action}-finish`, {
      response,
    });
  } catch (error) {
    await post(csrf, "cancel").catch(() => {});
    throw error;
  }
}
export function cancelKeyPrompt(): void {
  activePrompt?.abort();
  WebAuthnAbortService.cancelCeremony();
}

export async function replaceFallbackPassword(csrf: string, newPassword: string, confirmNewPassword: string) {
  activePrompt = new AbortController();
  const prompt = activePrompt;
  try {
    const verification = await post<{ options: PublicKeyCredentialRequestOptionsJSON }>(csrf, "password-start");
    prompt.signal.throwIfAborted();
    const response = await startAuthentication({ optionsJSON: verification.options });
    return await post<{ nextPath: string }>(csrf, "password-finish", { response, newPassword, confirmNewPassword });
  } catch (error) {
    await post(csrf, "cancel").catch(() => {});
    throw error;
  }
}

export async function removeKey(
  csrf: string,
  credentialId: string,
  password?: string,
) {
  activePrompt = new AbortController();
  const prompt = activePrompt;
  try {
    const verification = await post<{
      options?: PublicKeyCredentialRequestOptionsJSON;
    }>(csrf, "remove-start", { credentialId });
    prompt.signal.throwIfAborted();
    if (verification.options) {
      const response = await startAuthentication({
        optionsJSON: verification.options,
      });
      return await post<{ nextPath: string }>(csrf, "remove-finish", {
        credentialId,
        response,
      });
    }
    return await post<{ nextPath: string }>(csrf, "remove-finish", {
      credentialId,
      password,
    });
  } catch (error) {
    await post(csrf, "cancel").catch(() => {});
    throw error;
  }
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
