import { expect, test, vi } from "vitest";

import {
  ProviderCredentialRejectedError,
  ProviderCredentialUnavailableError,
} from "../app/photo-analysis/credentials.server";
import { RemotePhotoAnalysisCredentialValidator } from "../app/photo-analysis/provider-credential-validation.server";

test("validates Gemini and TypeSafe keys through their authenticated model-list endpoints", async () => {
  const network = vi.fn<(input: string | URL, init?: RequestInit) => Promise<Response>>(
    async () => new Response('{"models":[]}', { status: 200 }),
  );
  const validator = new RemotePhotoAnalysisCredentialValidator(network);

  await validator.validateGemini("gemini-private-key");
  await validator.validateTypeSafe("typesafe-private-key");

  expect(network).toHaveBeenCalledTimes(2);
  const [geminiUrl, geminiRequest] = network.mock.calls[0];
  expect(String(geminiUrl)).toBe("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1");
  expect(new Headers(geminiRequest?.headers).get("x-goog-api-key")).toBe("gemini-private-key");
  expect(String(geminiUrl)).not.toContain("gemini-private-key");
  const [typeSafeUrl, typeSafeRequest] = network.mock.calls[1];
  expect(String(typeSafeUrl)).toBe("https://api.typesafe.ai/v1/models");
  expect(new Headers(typeSafeRequest?.headers).get("Authorization")).toBe("Bearer typesafe-private-key");
  expect(String(typeSafeUrl)).not.toContain("typesafe-private-key");
});

test.each([401, 403])("maps provider rejection status %s to a non-secret typed error", async status => {
  const key = "key-that-must-not-appear";
  const validator = new RemotePhotoAnalysisCredentialValidator(
    vi.fn(async () => new Response(`provider response containing ${key}`, { status })),
  );

  await expect(validator.validateGemini(key)).rejects.toEqual(
    new ProviderCredentialRejectedError(),
  );
});

test.each([
  vi.fn(async () => new Response("provider internals", { status: 500 })),
  vi.fn(async () => { throw new Error("network internals"); }),
])("maps provider and network failures to a non-secret unavailable error", async network => {
  const validator = new RemotePhotoAnalysisCredentialValidator(network);
  await expect(validator.validateTypeSafe("private-typesafe-key")).rejects.toEqual(
    new ProviderCredentialUnavailableError(),
  );
  expect(network).toHaveBeenCalledTimes(1);
});
