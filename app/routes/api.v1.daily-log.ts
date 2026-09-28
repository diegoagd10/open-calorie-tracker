import type { Route } from "./+types/api.v1.daily-log";
import type { FoodLogService } from "../food-log/food-log.server";
import { parseIsoLocalDate } from "../food-log/date";
import { getFoodLogService } from "../food-log/runtime.server";
import { presentsApiKey } from "../api-keys/authentication.server";
import { getApiKeyAuthenticator } from "../api-keys/runtime.server";
import { getClientIp } from "../auth/http.server";
import { authenticateDailyLogBearer } from "../oauth/authorization.server";

type FoodLog = NonNullable<ReturnType<FoodLogService["read"]>>;
type Food = FoodLog["entries"][number];
type Water = FoodLog["waterEvents"][number];

const privateHeaders = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };

function apiError(error: string, status: number, headers: Record<string, string> = {}) {
  return Response.json({ error }, { status, headers: { ...privateHeaders, ...headers } });
}

function presentFood(entry: Food) {
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

function presentWater(event: Water) {
  return {
    id: event.id,
    foodLogDate: event.foodLogDate,
    localEventTime: event.localEventTime,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    amountMicroliters: event.amountMicroliters,
    preset8Count: event.preset8Count,
    preset16Count: event.preset16Count,
    preset24Count: event.preset24Count,
  };
}

function presentNutritionTotal(value: { known: number; isIncomplete: boolean }) {
  return { known: value.known, isIncomplete: value.isIncomplete };
}

function presentDailyFoodLog(foodLog: FoodLog) {
  const totals = foodLog.nutritionTotals;
  return {
    version: "1" as const,
    selectedDate: foodLog.selectedDate,
    today: foodLog.today,
    isFuture: foodLog.isFuture,
    timeZone: foodLog.timeZone,
    displayUnits: foodLog.displayUnits,
    goal: foodLog.goal ? {
      effectiveDate: foodLog.goal.effectiveDate,
      calorieTargetMilliKcal: foodLog.goal.calorieTargetMilliKcal,
      waterTargetMicroliters: foodLog.goal.waterTargetMicroliters,
      proteinTargetMilligrams: foodLog.goal.proteinTargetMilligrams,
      carbohydrateTargetMilligrams: foodLog.goal.carbohydrateTargetMilligrams,
      fatTargetMilligrams: foodLog.goal.fatTargetMilligrams,
      fiberTargetMilligrams: foodLog.goal.fiberTargetMilligrams,
      sugarMaximumMilligrams: foodLog.goal.sugarMaximumMilligrams,
      sodiumMaximumMilligrams: foodLog.goal.sodiumMaximumMilligrams,
    } : null,
    foodEntries: foodLog.entries.map(presentFood),
    waterEvents: foodLog.waterEvents.map(presentWater),
    events: foodLog.events.map((event) => event.kind === "food"
      ? { kind: "food" as const, ...presentFood(event) }
      : { kind: "water" as const, ...presentWater(event) }),
    nutritionTotals: {
      energyMilliKcal: presentNutritionTotal(totals.energyMilliKcal),
      proteinMilligrams: presentNutritionTotal(totals.proteinMilligrams),
      carbohydrateMilligrams: presentNutritionTotal(totals.carbohydrateMilligrams),
      fatMilligrams: presentNutritionTotal(totals.fatMilligrams),
      fiberMilligrams: presentNutritionTotal(totals.fiberMilligrams),
      sugarMilligrams: presentNutritionTotal(totals.sugarMilligrams),
      sodiumMilligrams: presentNutritionTotal(totals.sodiumMilligrams),
    },
    waterTotalMicroliters: foodLog.waterTotalMicroliters,
  };
}

export function headers() {
  return privateHeaders;
}

function authenticate(request: Request) {
  const authorization = request.headers.get("Authorization");
  return presentsApiKey(authorization)
    ? getApiKeyAuthenticator().authenticate(authorization, getClientIp(request), "daily-log:read")
    : authenticateDailyLogBearer(authorization);
}

export function loader({ request }: Route.LoaderArgs) {
  const caller = authenticate(request);
  if (!caller.ok) {
    if (caller.error === "rate_limited") return apiError("rate_limited", 429, { "Retry-After": String(caller.retryAfterSeconds) });
    return caller.error === "insufficient_scope"
      ? apiError("insufficient_scope", 403, { "WWW-Authenticate": 'Bearer realm="daily-log", error="insufficient_scope", scope="daily-log:read"' })
      : apiError("invalid_token", 401, { "WWW-Authenticate": 'Bearer realm="daily-log", error="invalid_token"' });
  }
  const dates = new URL(request.url).searchParams.getAll("date");
  if (dates.length !== 1 || !parseIsoLocalDate(dates[0])) return apiError("invalid_date", 400);
  const foodLog = getFoodLogService().read(caller.userId, dates[0]);
  if (!foodLog) return apiError("missing_setup", 409);
  return Response.json(presentDailyFoodLog(foodLog), { headers: privateHeaders });
}

export function action() {
  return apiError("method_not_allowed", 405);
}
