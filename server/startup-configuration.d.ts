export function validateServerConfiguration(
  environment: Record<string, string | undefined>,
): { port: number; lanPort?: number; lanHost?: "0.0.0.0" | "::" };
