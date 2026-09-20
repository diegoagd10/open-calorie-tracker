import { expect, test } from "vitest";

import type { UsdaPhotoAnalysisReadiness } from "../app/catalog/usda-evidence";
import {
  PhotoAnalysisReadinessService,
  PhotoAnalysisUnavailableError,
} from "../app/photo-analysis/readiness.server";
import { presentPhotoAnalysisReadiness } from "../app/routes/photo-analysis-readiness";

function service(input: {
  credentials?: "configured" | "unconfigured" | "unreadable";
  models?: { ready: boolean; reason?: string };
  catalog?: UsdaPhotoAnalysisReadiness;
}) {
  return new PhotoAnalysisReadinessService(
    {
      status: async () =>
        input.credentials === "configured"
          ? {
              state: "configured",
              configuredAt: "2026-09-20T00:00:00.000Z",
              updatedAt: "2026-09-20T00:00:00.000Z",
              validatedAt: "2026-09-20T00:00:00.000Z",
            }
          : input.credentials === "unreadable"
            ? {
                state: "unreadable",
                configuredAt: "2026-09-20T00:00:00.000Z",
                updatedAt: "2026-09-20T00:00:00.000Z",
              }
            : { state: "unconfigured" },
    },
    {
      readSettings: async () => ({
        ready: input.models?.ready ?? true,
        reason: input.models?.reason,
      }),
    },
    {
      photoAnalysisReadiness: async () =>
        input.catalog ?? { state: "ready", generation: "generation-one" },
    },
  );
}

test.each([
  [
    { credentials: "unconfigured" as const },
    "missing-credentials",
    "/settings/ai",
    "Configure Gemini and TypeSafe credentials.",
  ],
  [
    { credentials: "unreadable" as const },
    "unreadable-credentials",
    "/settings/ai",
    "Repair the Photo Analysis credential encryption setup.",
  ],
  [
    {
      credentials: "configured" as const,
      models: { ready: false, reason: "The selected Gemini model is unavailable." },
    },
    "unavailable-models",
    "/settings/ai",
    "The selected Gemini model is unavailable.",
  ],
  [
    {
      credentials: "configured" as const,
      catalog: { state: "not-installed" as const },
    },
    "catalog-not-installed",
    "/settings/catalogs",
    "Install USDA Foundation for Photo Analysis.",
  ],
  [
    {
      credentials: "configured" as const,
      catalog: { state: "reimport-required" as const, generation: "legacy" },
    },
    "catalog-reimport-required",
    "/settings/catalogs",
    "Reimport USDA Foundation for Photo Analysis.",
  ],
  [
    {
      credentials: "configured" as const,
      catalog: { state: "unavailable" as const, generation: "broken" },
    },
    "catalog-unavailable",
    "/settings/catalogs",
    "Repair or reimport USDA Foundation for Photo Analysis.",
  ],
])("reports each readiness failure without exposing details to members", async (
  input,
  code,
  destination,
  administratorReason,
) => {
  const readinessService = service(input);
  const readiness = await readinessService.read();
  expect(readiness).toEqual({
    state: "unavailable",
    code,
    ...(code === "unavailable-models"
      ? { detail: "The selected Gemini model is unavailable." }
      : {}),
  });
  expect(presentPhotoAnalysisReadiness(readiness, "admin")).toEqual({
    state: "unavailable",
    reason: administratorReason,
    destination,
  });
  expect(presentPhotoAnalysisReadiness(readiness, "member")).toEqual({
    state: "unavailable",
    reason: "AI photo analysis is not available right now.",
  });
});

test("ready state is shared and failures become the route-safe unavailable error", async () => {
  const readiness = await service({ credentials: "configured" }).read();
  expect(readiness).toEqual({ state: "ready" });
  expect(presentPhotoAnalysisReadiness(readiness, "member")).toEqual({ state: "ready" });

  const failure = new PhotoAnalysisUnavailableError("catalog-not-installed");
  expect(presentPhotoAnalysisReadiness(
    { state: "unavailable", code: failure.code },
    "admin",
  )).toMatchObject({
    reason: "Install USDA Foundation for Photo Analysis.",
    destination: "/settings/catalogs",
  });
  expect(presentPhotoAnalysisReadiness(
    { state: "unavailable", code: failure.code },
    "member",
  )).toEqual({
    state: "unavailable",
    reason: "AI photo analysis is not available right now.",
  });
});
