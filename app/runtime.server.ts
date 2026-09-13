import { AsyncLocalStorage } from "node:async_hooks";

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

export type RequestEntry = "tunnel" | "lan" | "development";
export type RequestPolicy = { entry: RequestEntry; origin: string };
export const requestPolicyContext = new AsyncLocalStorage<RequestPolicy>();

export function configuredEntryOrigin(entry: RequestEntry): string {
  if (entry !== "lan") return applicationOrigin();
  return new URL(z.string().url().parse(process.env.LAN_URL)).origin;
}

export function effectiveRequestPolicy(): RequestPolicy {
  // Direct route/service calls retain the public cookie contract. HTTP hosts
  // always establish a listener-owned context before invoking React Router.
  return requestPolicyContext.getStore() ?? {
    entry: "tunnel",
    origin: applicationOrigin(),
  };
}

export function enrollmentPreviewEnabled(): boolean {
  return process.env.WEBAUTHN_ENROLLMENT_PREVIEW === "1";
}
