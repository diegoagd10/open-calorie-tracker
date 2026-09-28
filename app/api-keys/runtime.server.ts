import { initializeCredentialStorage } from "../credentials/runtime.server";
import { ApiKeys } from "./api-keys.server";

export async function getApiKeys(): Promise<ApiKeys> {
  return new ApiKeys(await initializeCredentialStorage());
}
