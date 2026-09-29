import type { FoodLogService } from "../food-log/food-log.server";
import type { ApiKeyScope } from "../api-keys/presets";
import { getApiKeyAuthenticator } from "../api-keys/runtime.server";
import { getClientIp } from "../auth/http.server";

type FoodLog = NonNullable<ReturnType<FoodLogService["read"]>>;
type Food = FoodLog["entries"][number];

/** An API key's owner, once the key is valid and has an accepted scope. */
export type ApiCaller = { userId: number };

/** Headers on every `/api/v1` response, successful or not. */
export const privateHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

/** A private `snake_case` error body with its HTTP status. */
export function apiError(error: string, status: number, headers: Record<string, string> = {}) {
  return Response.json({ error }, { status, headers: { ...privateHeaders, ...headers } });
}

/**
 * The caller of a REST endpoint that accepts any one of `scopes`, or the refusal
 * with its Bearer challenge for `realm`.
 */
export function authenticateApiKey(request: Request, realm: string, scopes: readonly ApiKeyScope[]): ApiCaller | Response {
  const caller = getApiKeyAuthenticator().authenticate(request.headers.get("Authorization"), getClientIp(request), scopes);
  if (caller.ok) return { userId: caller.userId };
  if (caller.error === "rate_limited") return apiError("rate_limited", 429, { "Retry-After": String(caller.retryAfterSeconds) });
  return caller.error === "insufficient_scope"
    ? apiError("insufficient_scope", 403, { "WWW-Authenticate": `Bearer realm="${realm}", error="insufficient_scope", scope="${scopes.join(" ")}"` })
    : apiError("invalid_token", 401, { "WWW-Authenticate": `Bearer realm="${realm}", error="invalid_token"` });
}

/** A Food Entry in the canonical `/api/v1` shape. */
export function presentFood(entry: Food) {
  return {
    id: entry.id,
    foodLogDate: entry.foodLogDate,
    localEventTime: entry.localEventTime,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
    name: entry.name,
    originalName: entry.originalName,
    provider: entry.provider,
    providerFoodId: entry.providerFoodId,
    dataType: entry.dataType,
    providerPublishedDate: entry.providerPublishedDate,
    providerModifiedDate: entry.providerModifiedDate,
    brand: entry.brand,
    barcode: entry.barcode,
    marketCountry: entry.marketCountry,
    authoritativeBaseUnit: entry.authoritativeBaseUnit,
    authoritativeBaseQuantityMicrounits: entry.authoritativeBaseQuantityMicrounits,
    authoritativeNutrition: entry.authoritativeNutrition,
    selectedMeasurementId: entry.selectedMeasurementId,
    selectedMeasurementLabel: entry.selectedMeasurementLabel,
    selectedMeasurementUnit: entry.selectedMeasurementUnit,
    supportedMeasurements: entry.supportedMeasurements,
    quantityMicrounits: entry.quantityMicrounits,
    energyMilliKcal: entry.energyMilliKcal,
    proteinMilligrams: entry.proteinMilligrams,
    carbohydrateMilligrams: entry.carbohydrateMilligrams,
    fatMilligrams: entry.fatMilligrams,
    fiberMilligrams: entry.fiberMilligrams,
    sugarMilligrams: entry.sugarMilligrams,
    sodiumMilligrams: entry.sodiumMilligrams,
  };
}
