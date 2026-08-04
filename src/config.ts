import path from "node:path";

export interface AppConfig {
  port: number;
  dataDir: string;
  timezone: string;
  openFoodFactsUserAgent: string;
  openAiApiKey: string;
  openAiModel: string;
  maxImageBytes: number;
}

export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format();
    return true;
  } catch {
    return false;
  }
}

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const port = Number(environment.PORT || 3000);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) throw new Error("PORT must be a valid TCP port.");
  const timezone = environment.TIMEZONE || "UTC";
  if (!isValidTimezone(timezone)) throw new Error(`Invalid TIMEZONE: ${timezone}`);
  const maxImageBytes = Number(environment.MAX_IMAGE_BYTES || 10 * 1024 * 1024);
  if (!Number.isInteger(maxImageBytes) || maxImageBytes <= 0) throw new Error("MAX_IMAGE_BYTES must be a positive integer.");
  return {
    port,
    dataDir: path.resolve(environment.DATA_DIR || path.join(process.cwd(), "data")),
    timezone,
    openFoodFactsUserAgent: environment.OPEN_FOOD_FACTS_USER_AGENT || "Calories/1.0 (self-hosted)",
    openAiApiKey: environment.OPENAI_API_KEY || "",
    openAiModel: environment.OPENAI_MODEL || "gpt-5.6-terra",
    maxImageBytes,
  };
}
