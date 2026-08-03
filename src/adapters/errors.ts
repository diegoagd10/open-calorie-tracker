export type ProviderFailureKind =
  | "invalid"
  | "not_found"
  | "incomplete"
  | "conflicting"
  | "temporarily_unavailable"
  | "refused"
  | "unexpected";

export class ProviderFailure extends Error {
  readonly retryable: boolean;
  readonly manualFallback: boolean;

  constructor(
    readonly kind: ProviderFailureKind,
    message: string,
    options: { retryable?: boolean; manualFallback?: boolean } = {},
  ) {
    super(message);
    this.name = "ProviderFailure";
    this.retryable = options.retryable ?? kind === "temporarily_unavailable";
    this.manualFallback = options.manualFallback ?? (kind !== "not_found" && kind !== "invalid");
  }
}

export function classifyHttpFailure(status: number, provider: string): ProviderFailure {
  if (status === 404) return new ProviderFailure("not_found", `${provider} did not find a matching record.`, { manualFallback: true });
  if (status === 400 || status === 422) return new ProviderFailure("invalid", `${provider} rejected the request.`, { retryable: false, manualFallback: true });
  if (status === 409) return new ProviderFailure("conflicting", `${provider} returned conflicting data.`, { retryable: false, manualFallback: true });
  if (status === 429 || status >= 500) return new ProviderFailure("temporarily_unavailable", `${provider} is temporarily unavailable.`);
  return new ProviderFailure("unexpected", `${provider} returned HTTP ${status}.`, { retryable: false, manualFallback: true });
}

export function asProviderFailure(error: unknown, provider: string): ProviderFailure {
  if (error instanceof ProviderFailure) return error;
  if (error instanceof TypeError && /fetch|network|socket|connect|timeout|timed out|aborted/i.test(error.message)) {
    return new ProviderFailure("temporarily_unavailable", `${provider} could not be reached.`, { retryable: true, manualFallback: true });
  }
  if (error && typeof error === "object" && "status" in error && (Number(error.status) === 429 || Number(error.status) >= 500)) {
    return new ProviderFailure("temporarily_unavailable", `${provider} is temporarily unavailable.`, { retryable: true, manualFallback: true });
  }
  return new ProviderFailure("unexpected", `${provider} returned an unexpected failure.`, { retryable: false, manualFallback: true });
}
