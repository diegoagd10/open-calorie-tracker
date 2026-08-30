export type OperationalLogLevel = "error" | "info" | "warn";

export function operationalLog(
  level: OperationalLogLevel,
  event: string,
  details?: Record<string, unknown>,
): void;

export function operationalError(
  error: unknown,
  includeMessage?: boolean,
): { message?: string; name: string };
