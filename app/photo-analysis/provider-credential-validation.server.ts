import {
  ProviderCredentialRejectedError,
  ProviderCredentialUnavailableError,
  type PhotoAnalysisCredentialValidator,
} from "./credentials.server";

export type CredentialValidationNetwork = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export class RemotePhotoAnalysisCredentialValidator implements PhotoAnalysisCredentialValidator {
  constructor(private readonly network: CredentialValidationNetwork = fetch) {}

  async validateGemini(key: string): Promise<void> {
    await this.validate(
      "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1",
      { "x-goog-api-key": key },
    );
  }

  async validateTypeSafe(key: string): Promise<void> {
    await this.validate(
      "https://api.typesafe.ai/v1/models",
      { Authorization: `Bearer ${key}` },
    );
  }

  private async validate(url: string, headers: HeadersInit): Promise<void> {
    let response: Response;
    try {
      response = await this.network(url, {
        headers,
        method: "GET",
        signal: AbortSignal.timeout(5_000),
      });
    } catch {
      throw new ProviderCredentialUnavailableError();
    }
    void response.body?.cancel();
    if (response.status === 401 || response.status === 403) {
      throw new ProviderCredentialRejectedError();
    }
    if (!response.ok) throw new ProviderCredentialUnavailableError();
  }
}
