import { initializeCredentialStorage } from "../credentials/runtime.server";
import { getApplicationDatabase } from "../database/runtime.server";
import { ApiKeys } from "./api-keys.server";
import { ApiKeyAuthenticator } from "./authentication.server";

export async function getApiKeys(): Promise<ApiKeys> {
  return new ApiKeys(await initializeCredentialStorage());
}

export function getApiKeyAuthenticator(): ApiKeyAuthenticator {
  return new ApiKeyAuthenticator(getApplicationDatabase().getClient());
}
