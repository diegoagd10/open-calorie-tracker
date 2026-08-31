import { z } from "zod";

const applicationUrlSchema = z.string().url();

export function applicationOrigin(): string {
  const fallbackUrl = `http://localhost:${process.env.PORT ?? "3000"}`;
  const applicationUrl = applicationUrlSchema.parse(
    process.env.APPLICATION_URL ?? fallbackUrl,
  );
  return new URL(applicationUrl).origin;
}

export function isProductionEnvironment(): boolean {
  return process.env.NODE_ENV === "production";
}

export function isTestEnvironment(): boolean {
  return process.env.NODE_ENV === "test";
}
