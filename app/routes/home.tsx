import { randomUUID } from "node:crypto";

import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { z } from "zod";
import type { Route } from "./+types/home";
import {
  data,
  Form,
  Link,
  redirect,
  useNavigate,
  useNavigation,
} from "react-router";

import {
  getSessionForApplicationAccess,
  requireValidOrigin,
  serializeClearedSessionCookie,
} from "../auth/http.server";
import { getPhotoAnalysisService } from "../photo-analysis/runtime.server";
import { PhotoMeals, PhotoCorrection, usePhotoUpload } from "./photo-meals";
import { AppNavigation } from "../app-navigation";
import { isTestEnvironment } from "../runtime.server";
import { UiIcon } from "../ui-icon";
import { BarcodeCameraScanner } from "./barcode-camera-scanner";
import { getAuthenticationService } from "../auth/runtime.server";
import {
  CatalogConfigurationError,
  CatalogCredentialsError,
  CatalogFoodNotFoundError,
  CatalogInvalidResponseError,
  CatalogNutritionUnavailableError,
  CatalogRateLimitError,
  CatalogUnknownProviderError,
  CatalogUnavailableError,
  CatalogUnsafeMeasurementError,
  type CatalogOperationContext,
  type CatalogFood,
  type CatalogNutrientValue,
  type CatalogSearchResult,
} from "../catalog/food-catalog.server";
import { isSupportedCommercialBarcode } from "../catalog/barcode";
import {
  getFoodCatalog,
  getFoodCatalogProvider,
} from "../catalog/runtime.server";
import {
  addLocalDays,
  buildCalendarMonth,
  formatLocalDate,
  getNearbyLocalDates,
  parseIsoLocalDate,
} from "../food-log/date";
import {
  FutureFoodLogDateError,
  InvalidFoodLogDateError,
} from "../food-log/food-log.server";
import { getFoodLogService } from "../food-log/runtime.server";
import {
  copyFoodEntryIdempotencyKeySchema,
  createCopyFoodEntryIdempotencyKey,
  FoodEntryUnavailableError,
  InvalidFoodEntryInputError,
  StaleFoodEntryError,
} from "../food-entry/food-entry.server";
import { getFoodEntryService } from "../food-entry/runtime.server";
import {
  quantityMicrounitsFromDecimal,
  scaleCatalogNutrient,
} from "../food-entry/nutrition";
import {
  StaleWaterEventError,
  InvalidWaterEventInputError,
  WaterEventUnavailableError,
} from "../water-event/water-event.server";
import { getWaterEventService } from "../water-event/runtime.server";
import {
  waterTargetThousandthsFromMicroliters,
  type DisplayUnits,
} from "../goals/water-conversion";
import styles from "../food-log.module.css";

function catalogQuery(value: string): string | undefined {
  const query = value.trim();
  return query.length >= 2 && query.length <= 100 ? query : undefined;
}

function catalogBarcode(value: string): string | undefined {
  const barcode = value.trim();
  return isSupportedCommercialBarcode(barcode) ? barcode : undefined;
}

function foodLogIntentSchema() {
  return z.discriminatedUnion("intent", [
    z.object({ date: z.string(), intent: z.literal("add-food") }),
    z.object({ date: z.string(), intent: z.literal("add-water") }),
    z.object({
      date: z.string(),
      eventId: z.string(),
      intent: z.literal("create-water"),
      waterAmount: z.string(),
      waterSelection: z.enum(["8", "16", "24", "exact"]),
    }),
    z.object({
      date: z.string(),
      eventId: z.string(),
      expectedUpdatedAt: z.string(),
      intent: z.literal("update-water"),
      waterAmount: z.string(),
      waterEventTime: z.string(),
      waterSelection: z.enum(["8", "16", "24", "exact"]),
    }),
    z.object({
      date: z.string(),
      eventId: z.string(),
      expectedUpdatedAt: z.string(),
      intent: z.literal("delete-water"),
    }),
    z.object({
      date: z.string(),
      idempotencyKey: z.string(),
      intent: z.literal("log-food"),
      provider: z.string().min(1),
      providerFoodId: z.string(),
      quantity: z.string(),
      selectedMeasurementId: z.string(),
    }),
    z.object({
      date: z.string().refine((value) => parseIsoLocalDate(value) !== undefined),
      entryId: z.string().refine((value) => positiveIntegerId(value) !== undefined),
      idempotencyKey: copyFoodEntryIdempotencyKeySchema,
      intent: z.literal("copy-food-to-today"),
    }),
    z.object({
      date: z.string().refine((value) => parseIsoLocalDate(value) !== undefined),
      destinationDate: z.string().refine(
        (value) => parseIsoLocalDate(value) !== undefined,
      ),
      entryId: z.string().refine((value) => positiveIntegerId(value) !== undefined),
      idempotencyKey: copyFoodEntryIdempotencyKeySchema,
      intent: z.literal("copy-food-to-date"),
    }),
    z.object({
      carbohydrateGrams: z.string(),
      date: z.string(),
      energyKcal: z.string(),
      fatGrams: z.string(),
      fiberGrams: z.string(),
      idempotencyKey: z.string(),
      intent: z.literal("log-manual-food"),
      name: z.string(),
      proteinGrams: z.string(),
      quantity: z.string(),
      sodiumMilligrams: z.string(),
      sugarGrams: z.string(),
    }),
    z.object({
      carbohydrateGrams: z.string(),
      date: z.string(),
      energyKcal: z.string(),
      entryId: z.string(),
      expectedUpdatedAt: z.string(),
      fatGrams: z.string(),
      fiberGrams: z.string(),
      intent: z.literal("update-food"),
      name: z.string(),
      proteinGrams: z.string(),
      quantity: z.string(),
      selectedMeasurementId: z.string(),
      sodiumMilligrams: z.string(),
      sugarGrams: z.string(),
    }),
    z.object({
      date: z.string(),
      entryId: z.string(),
      expectedUpdatedAt: z.string(),
      intent: z.literal("delete-food"),
    }),
  ]);
}

type CurrentFoodEntry = ReturnType<
  ReturnType<typeof getFoodEntryService>["read"]
>;
type ManualFoodDraft = Extract<
  z.output<ReturnType<typeof foodLogIntentSchema>>,
  { intent: "log-manual-food" }
>;

type HomeActionData = {
  foodEntryEditor?: CurrentFoodEntry;
  manualFoodDraft?: ManualFoodDraft;
  message: string;
  tone?: "error" | "status";
  waterEventEditor?: ReturnType<
    ReturnType<typeof getWaterEventService>["read"]
  >;
};

function testRequestInstant(request: Request): Date | undefined {
  const requestedInstant =
    isTestEnvironment()
      ? request.headers.get("X-Test-Food-Log-Now")
      : undefined;
  if (!requestedInstant) return undefined;

  const instant = new Date(requestedInstant);
  if (Number.isNaN(instant.getTime())) {
    throw new Response("Test Food Log instant is invalid.", { status: 400 });
  }
  return instant;
}

function foodLogServiceForRequest(request: Request) {
  const instant = testRequestInstant(request);
  return instant ? getFoodLogService(instant) : getFoodLogService();
}

function catalogFailure(
  error: unknown,
): { message: string; status: number; title: string } | undefined {
  if (error instanceof CatalogConfigurationError) {
    return {
      message:
        "USDA search is not configured. Your saved Food Entries remain available.",
      status: 503,
      title: "USDA search is not configured",
    };
  }
  if (error instanceof CatalogCredentialsError) {
    return {
      message:
        "USDA search credentials are unavailable. Your saved Food Entries remain available.",
      status: 503,
      title: "USDA credentials unavailable",
    };
  }
  if (error instanceof CatalogRateLimitError) {
    return {
      message: "USDA rate limit reached. Wait a moment and search again.",
      status: 429,
      title: "USDA rate limit reached",
    };
  }
  if (error instanceof CatalogFoodNotFoundError) {
    return {
      message:
        "USDA listed this food in search, but its details are no longer available. Choose another result.",
      status: 409,
      title: "Food no longer available",
    };
  }
  if (error instanceof CatalogUnsafeMeasurementError) {
    return {
      message: "That food has no safe provider-backed measurement to log.",
      status: 422,
      title: "Measurement unavailable",
    };
  }
  if (error instanceof CatalogInvalidResponseError) {
    return {
      message: "USDA returned food data that could not be used safely.",
      status: 502,
      title: "USDA response could not be used",
    };
  }
  if (error instanceof CatalogUnavailableError) {
    return {
      message:
        "USDA is unavailable right now. Your saved Food Entries are unaffected.",
      status: 503,
      title: "USDA is unavailable",
    };
  }
  return undefined;
}

function barcodeCatalogFailure(
  error: unknown,
): { message: string; status: number; title: string } | undefined {
  if (error instanceof CatalogConfigurationError) {
    return {
      message:
        "Open Food Facts needs a valid contact email before barcode lookup can be used. USDA search and saved Food Entries remain available.",
      status: 503,
      title: "Open Food Facts is not configured",
    };
  }
  if (error instanceof CatalogFoodNotFoundError) {
    return {
      message: "Product not found. Check the barcode or enter another code.",
      status: 404,
      title: "Product not found",
    };
  }
  if (error instanceof CatalogNutritionUnavailableError) {
    return {
      message:
        "This product does not report usable nutrition per serving. Values per 100 g or 100 ml are not converted.",
      status: 422,
      title: "Nutrition per serving unavailable",
    };
  }
  if (error instanceof CatalogUnsafeMeasurementError) {
    return {
      message:
        "This product no longer has the same usable 1 serving measurement. Your Food Log was not changed.",
      status: 422,
      title: "Serving unavailable",
    };
  }
  if (error instanceof CatalogRateLimitError) {
    return {
      message: "Open Food Facts rate limit reached. Wait a moment before retrying.",
      status: 429,
      title: "Open Food Facts rate limit reached",
    };
  }
  if (error instanceof CatalogInvalidResponseError) {
    return {
      message: "Open Food Facts returned product data that could not be used safely.",
      status: 502,
      title: "Open Food Facts response could not be used",
    };
  }
  if (error instanceof CatalogUnavailableError) {
    return {
      message: "Open Food Facts is unavailable right now. Retry in a moment.",
      status: 503,
      title: "Open Food Facts is unavailable",
    };
  }
  return undefined;
}

export function meta() {
  return [
    { title: "Open Calory Tracker · Private application" },
    {
      name: "description",
      content: "Your private Open Calory Tracker application space",
    },
  ];
}

export function headers() {
  return { "Cache-Control": "no-store" };
}

function catalogOperationContext(request: Request): CatalogOperationContext {
  return {
    requestId:
      request.headers.get("x-open-calory-request-id") ?? randomUUID(),
  };
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await getSessionForApplicationAccess(request);

  if (!session) {
    return redirect(
      getAuthenticationService().isRegistrationOpen() ? "/register" : "/login",
    );
  }

  const url = new URL(request.url);
  const catalogContext = catalogOperationContext(request);
  let foodLog;
  try {
    foodLog = foodLogServiceForRequest(request).read(
      session.user.id,
      url.searchParams.get("date") ?? undefined,
    );
  } catch (error) {
    if (error instanceof InvalidFoodLogDateError) {
      throw new Response(error.message, { status: 400 });
    }
    throw error;
  }
  if (!foodLog) return redirect("/setup");
  const photoMeals = getPhotoAnalysisService().list(session.user.id, foodLog.selectedDate);

  const copyIdempotencyKeys =
    foodLog.selectedDate < foodLog.today
      ? Object.fromEntries(
          foodLog.events
            .filter((entry) => entry.kind === "food")
            .map((entry) => [
              entry.id,
              createCopyFoodEntryIdempotencyKey(entry.id, randomUUID()),
            ]),
        )
      : {};
  const noticeKind = url.searchParams.get("notice");
  const copiedEntryId =
    noticeKind === "copied"
      ? positiveIntegerId(url.searchParams.get("copied"))
      : undefined;
  let copiedFood:
    | { destinationDate: string; name: string }
    | undefined;
  if (copiedEntryId !== undefined) {
    try {
      const copiedEntry = getFoodEntryService(
        testRequestInstant(request),
      ).readCopied(session.user.id, copiedEntryId);
      copiedFood = {
        destinationDate: copiedEntry.foodLogDate,
        name: copiedEntry.name,
      };
    } catch (error) {
      if (!(error instanceof FoodEntryUnavailableError)) throw error;
    }
  }

  const nearbyDates = getNearbyLocalDates(foodLog.selectedDate, foodLog.today);
  const requestedCalendar = url.searchParams.get("calendar");
  const calendar = requestedCalendar
    ? buildCalendarMonth(requestedCalendar, foodLog.today, foodLog.selectedDate)
    : undefined;

  const requestedEntry = url.searchParams.get("entry");
  let foodEntryEditor;
  if (requestedEntry !== null && !foodLog.isFuture) {
    const entryId = positiveIntegerId(requestedEntry);
    if (entryId === undefined) {
      throw new Response("Food Entry is unavailable.", { status: 404 });
    }
    if (photoMeals.some((meal) => meal.entryId === entryId && meal.status === "active")) return redirect(foodLogHref(foodLog.selectedDate));
    try {
      foodEntryEditor = getFoodEntryService(testRequestInstant(request)).read(
        session.user.id,
        entryId,
      );
      if (foodEntryEditor.foodLogDate !== foodLog.selectedDate) {
        throw new FoodEntryUnavailableError();
      }
    } catch (error) {
      if (error instanceof FoodEntryUnavailableError) {
        throw new Response(error.message, { status: 404 });
      }
      throw error;
    }
  }

  const requestedCopy = url.searchParams.get("copy");
  let copyDialog;
  let copyError: string | undefined;
  if (requestedCopy !== null && foodLog.selectedDate < foodLog.today) {
    const entryId = positiveIntegerId(requestedCopy);
    if (entryId === undefined) {
      copyError = "That Food Entry is unavailable. Choose another entry.";
    } else {
      try {
        const entry = getFoodEntryService(testRequestInstant(request)).read(
          session.user.id,
          entryId,
        );
        if (entry.foodLogDate !== foodLog.selectedDate) {
          throw new FoodEntryUnavailableError();
        }
        const requestedDestination = url.searchParams.get("copyDate");
        const destinationDate =
          requestedDestination &&
          parseIsoLocalDate(requestedDestination) &&
          requestedDestination <= foodLog.today &&
          requestedDestination !== entry.foodLogDate
            ? requestedDestination
            : undefined;
        const calendar = buildCalendarMonth(
          url.searchParams.get("copyMonth") ?? entry.foodLogDate.slice(0, 7),
          foodLog.today,
          destinationDate ?? "",
        );
        copyDialog = {
          calendar: {
            ...calendar,
            days: calendar.days.map((day) => ({
              ...day,
              isSource: day.date === entry.foodLogDate,
            })),
          },
          destinationDate,
          entry,
          idempotencyKey: createCopyFoodEntryIdempotencyKey(
            entry.id,
            randomUUID(),
          ),
        };
      } catch (error) {
        if (error instanceof FoodEntryUnavailableError) {
          copyError = "That Food Entry is unavailable. Choose another entry.";
        } else {
          throw error;
        }
      }
    }
  }

  const requestedWater = url.searchParams.get("water");
  let waterDialog:
    | { mode: "create" }
    | {
        event: ReturnType<ReturnType<typeof getWaterEventService>["read"]>;
        mode: "edit";
      }
    | undefined;
  if (requestedWater !== null && !foodLog.isFuture) {
    if (requestedWater === "new") {
      waterDialog = { mode: "create" };
    } else {
      const eventId = positiveIntegerId(requestedWater);
      if (eventId === undefined) {
        throw new Response("Water Event is unavailable.", { status: 404 });
      }
      try {
        const event = getWaterEventService(testRequestInstant(request)).read(
          session.user.id,
          eventId,
        );
        if (event.foodLogDate !== foodLog.selectedDate) {
          throw new WaterEventUnavailableError();
        }
        waterDialog = { event, mode: "edit" };
      } catch (error) {
        if (error instanceof WaterEventUnavailableError) {
          throw new Response(error.message, { status: 404 });
        }
        throw error;
      }
    }
  }

  const foodStage = catalogRouteState(url.searchParams.get("food"));
  const requestedQuery = url.searchParams.get("query") ?? "";
  let responseStatus = 200;
  let catalog:
    | {
        mode: "choose";
        query: string;
      }
    | {
        idempotencyKey: string;
        mode: "manual";
        query: string;
      }
    | {
        barcode: string;
        food: CatalogFood;
        idempotencyKey: string;
        message?: never;
        mode: "barcode";
        query: string;
        title?: never;
      }
    | {
        barcode: string;
        food?: undefined;
        idempotencyKey?: undefined;
        message?: string;
        mode: "barcode";
        query: string;
        title?: string;
      }
    | {
        mode: "search";
        query: string;
        results: Awaited<
          ReturnType<ReturnType<typeof getFoodCatalogProvider>["search"]>
        >;
        message?: string;
        title?: string;
      }
    | {
        mode: "detail";
        query: string;
        food: Awaited<
          ReturnType<ReturnType<typeof getFoodCatalogProvider>["getFood"]>
        >;
        idempotencyKey: string;
      }
    | undefined;
  if (foodStage && !foodLog.isFuture) {
    if (foodStage.mode === "choose") {
      catalog = { mode: "choose", query: "" };
    } else if (foodStage.mode === "manual") {
      catalog = { idempotencyKey: randomUUID(), mode: "manual", query: "" };
    } else if (foodStage.mode === "barcode") {
      const requestedBarcode = url.searchParams.get("barcode") ?? "";
      if (!requestedBarcode) {
        catalog = { barcode: "", mode: "barcode", query: "" };
      } else {
        const parsedBarcode = catalogBarcode(requestedBarcode);
        if (parsedBarcode === undefined) {
          responseStatus = 400;
          catalog = {
            barcode: requestedBarcode,
            message: "Enter a supported 7, 8, 12, 13, or 14 digit barcode.",
            mode: "barcode",
            query: "",
            title: "Barcode not valid",
          };
        } else {
          try {
            catalog = {
              barcode: parsedBarcode,
              food: await getFoodCatalog().lookupBarcode(
                "open-food-facts",
                parsedBarcode,
                catalogContext,
              ),
              idempotencyKey: randomUUID(),
              mode: "barcode",
              query: "",
            };
          } catch (error) {
            const failure = barcodeCatalogFailure(error);
            if (!failure) throw error;
            responseStatus = failure.status;
            catalog = {
              barcode: parsedBarcode,
              message: failure.message,
              mode: "barcode",
              query: "",
              title: failure.title,
            };
          }
        }
      }
    } else if (foodStage.mode === "search") {
      const parsedQuery = catalogQuery(requestedQuery);
      if (!requestedQuery) {
        catalog = { mode: "search", query: "", results: [] };
      } else if (parsedQuery === undefined) {
        responseStatus = 400;
        catalog = {
          message: "Enter a food search from 2 to 100 characters.",
          mode: "search",
          query: requestedQuery,
          results: [],
          title: "Search not sent",
        };
      } else {
        try {
          catalog = {
            mode: "search",
            query: parsedQuery,
            results: await getFoodCatalogProvider().search(
              parsedQuery,
              catalogContext,
            ),
          };
        } catch (error) {
          const failure = catalogFailure(error);
          if (!failure) throw error;
          responseStatus = failure.status;
          catalog = {
            message: failure.message,
            mode: "search",
            query: parsedQuery,
            results: [],
            title: failure.title,
          };
        }
      }
    } else {
      const provider = getFoodCatalogProvider();
      try {
        catalog = {
          food: await provider.getFood(foodStage.providerFoodId, catalogContext),
          idempotencyKey: randomUUID(),
          mode: "detail",
          query: requestedQuery,
        };
      } catch (error) {
        const failure = catalogFailure(error);
        if (!failure) throw error;
        responseStatus = failure.status;
        let results: CatalogSearchResult[] = [];
        const parsedQuery = catalogQuery(requestedQuery);
        if (
          error instanceof CatalogFoodNotFoundError &&
          parsedQuery !== undefined
        ) {
          try {
            results = (
              await provider.search(parsedQuery, catalogContext)
            ).filter(
              (result) => result.providerFoodId !== foodStage.providerFoodId,
            );
          } catch {
            // The original detail failure remains the useful response when
            // refreshing the surrounding search results also fails.
          }
        }
        catalog = {
          message: failure.message,
          mode: "search",
          query: requestedQuery,
          results,
          title: failure.title,
        };
      }
    }
  }

  return data(
    {
      calendar,
      catalog,
      copyDialog,
      copyError,
      copyIdempotencyKeys,
      csrfToken: session.csrfToken,
      foodEntryEditor,
      photoMeals,
      foodLog,
      nearbyDates,
      notice: noticeMessage(noticeKind, copiedFood, foodLog.today),
      username: session.user.username,
      waterDialog,
    },
    { status: responseStatus },
  );
}

function noticeMessage(
  value: string | null,
  copiedFood: { destinationDate: string; name: string } | undefined,
  today: string,
): string | undefined {
  if (value === "copied" && copiedFood) {
    return copiedFood.destinationDate === today
      ? `Copied ${copiedFood.name} to today's Food Log.`
      : `Copied ${copiedFood.name} to ${fullDate(copiedFood.destinationDate)}.`;
  }
  if (value === "updated") {
    return "Food Entry updated. Daily totals refreshed.";
  }
  if (value === "deleted") {
    return "Food Entry deleted. Daily totals updated.";
  }
  if (value === "water-created") {
    return "Water Event added. Daily total updated.";
  }
  if (value === "water-updated") {
    return "Water Event updated. Daily total refreshed.";
  }
  if (value === "water-deleted") {
    return "Water Event deleted. Daily total updated.";
  }
  return undefined;
}

type CatalogRouteState =
  | { mode: "barcode" }
  | { mode: "choose" }
  | { mode: "detail"; providerFoodId: string }
  | { mode: "manual" }
  | { mode: "search" };

function positiveIntegerId(value: string | null): number | undefined {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 && String(id) === value
    ? id
    : undefined;
}

function catalogRouteState(
  value: string | null,
): CatalogRouteState | undefined {
  if (value === "search") return { mode: "search" };
  if (value === "choose") return { mode: "choose" };
  if (value === "barcode") return { mode: "barcode" };
  if (value === "manual") return { mode: "manual" };
  const providerFoodId = positiveIntegerId(value);
  if (providerFoodId !== undefined) {
    return { mode: "detail", providerFoodId: String(providerFoodId) };
  }
  return undefined;
}

function formString(formData: FormData, name: string): string {
  const value = formData.get(name);
  // Stryker disable next-line StringLiteral: any non-string form part normalizes to the same rejected placeholder.
  return typeof value === "string" ? value : "";
}

export async function action({ request }: Route.ActionArgs) {
  requireValidOrigin(request);
  const session = await getSessionForApplicationAccess(request);
  if (!session) {
    return redirect("/login", {
      headers: { "Set-Cookie": serializeClearedSessionCookie() },
    });
  }
  const catalogContext = catalogOperationContext(request);

  const formData = await request.formData();
  if (
    !getAuthenticationService().verifyCsrfToken(
      session.token,
      // Stryker disable next-line StringLiteral: every placeholder for a missing opaque token is rejected identically.
      String(formData.get("csrfToken") ?? ""),
    )
  ) {
    throw new Response("CSRF token rejected.", { status: 403 });
  }

  const parsed = foodLogIntentSchema().safeParse({
    carbohydrateGrams: formString(formData, "carbohydrateGrams"),
    date: formString(formData, "date"),
    destinationDate: formString(formData, "destinationDate"),
    energyKcal: formString(formData, "energyKcal"),
    entryId: formString(formData, "entryId"),
    eventId: formString(formData, "eventId"),
    expectedUpdatedAt: formString(formData, "expectedUpdatedAt"),
    fatGrams: formString(formData, "fatGrams"),
    fiberGrams: formString(formData, "fiberGrams"),
    idempotencyKey: formString(formData, "idempotencyKey"),
    intent: formString(formData, "intent"),
    name: formString(formData, "name"),
    proteinGrams: formString(formData, "proteinGrams"),
    providerFoodId: formString(formData, "providerFoodId"),
    provider: formString(formData, "provider"),
    quantity: formString(formData, "quantity"),
    selectedMeasurementId: formString(formData, "selectedMeasurementId"),
    sodiumMilligrams: formString(formData, "sodiumMilligrams"),
    sugarGrams: formString(formData, "sugarGrams"),
    waterAmount: formString(formData, "waterAmount"),
    waterEventTime: formString(formData, "waterEventTime"),
    waterSelection: formString(formData, "waterSelection"),
  });
  if (!parsed.success) {
    return data<HomeActionData>(
      { message: "The Food Log request was invalid.", tone: "error" },
      { status: 400 },
    );
  }

  try {
    foodLogServiceForRequest(request).requireWritableDate(
      session.user.id,
      parsed.data.date,
    );
  } catch (error) {
    if (error instanceof FutureFoodLogDateError) {
      if (parsed.data.intent === "log-manual-food") {
        return data<HomeActionData>(
          {
            manualFoodDraft: parsed.data,
            message: error.message,
            tone: "error",
          },
          { status: 422 },
        );
      }
      return data<HomeActionData>({ message: error.message }, { status: 422 });
    }
    if (error instanceof InvalidFoodLogDateError) {
      if (parsed.data.intent === "log-manual-food") {
        return data<HomeActionData>(
          {
            manualFoodDraft: parsed.data,
            message: error.message,
            tone: "error",
          },
          { status: 400 },
        );
      }
      return data<HomeActionData>({ message: error.message }, { status: 400 });
    }
    throw error;
  }

  if (parsed.data.intent === "add-food") {
    return redirect(`${foodLogHref(parsed.data.date)}&food=choose`);
  }
  if (parsed.data.intent === "add-water") {
    return redirect(`${foodLogHref(parsed.data.date)}&water=new`);
  }

  if (parsed.data.intent === "log-manual-food") {
    try {
      getFoodEntryService(testRequestInstant(request)).logManual(
        session.user.id,
        {
          carbohydrateGrams: parsed.data.carbohydrateGrams,
          energyKcal: parsed.data.energyKcal,
          fatGrams: parsed.data.fatGrams,
          fiberGrams: parsed.data.fiberGrams,
          foodLogDate: parsed.data.date,
          idempotencyKey: parsed.data.idempotencyKey,
          name: parsed.data.name,
          proteinGrams: parsed.data.proteinGrams,
          quantity: parsed.data.quantity,
          sodiumMilligrams: parsed.data.sodiumMilligrams,
          sugarGrams: parsed.data.sugarGrams,
        },
      );
      return redirect(foodLogHref(parsed.data.date));
    } catch (error) {
      if (error instanceof InvalidFoodEntryInputError) {
        return data<HomeActionData>(
          {
            manualFoodDraft: parsed.data,
            message:
              "Enter a food name, valid quantity, and calories before adding this Food Entry.",
            tone: "error",
          },
          { status: 400 },
        );
      }
      throw error;
    }
  }

  if (
    parsed.data.intent === "create-water" ||
    parsed.data.intent === "update-water" ||
    parsed.data.intent === "delete-water"
  ) {
    const waterEventService = getWaterEventService(testRequestInstant(request));
    const eventId = Number(parsed.data.eventId);
    try {
      if (parsed.data.intent === "create-water") {
        waterEventService.create(
          session.user.id,
          parsed.data.waterSelection === "exact"
            ? {
                amount: parsed.data.waterAmount,
                foodLogDate: parsed.data.date,
                selection: "exact",
              }
            : {
                foodLogDate: parsed.data.date,
                selection: parsed.data.waterSelection,
              },
        );
        return redirect(`${foodLogHref(parsed.data.date)}&notice=water-created`);
      }
      if (parsed.data.intent === "delete-water") {
        waterEventService.delete(session.user.id, eventId, {
          expectedUpdatedAt: parsed.data.expectedUpdatedAt,
          foodLogDate: parsed.data.date,
        });
        return redirect(`${foodLogHref(parsed.data.date)}&notice=water-deleted`);
      }
      waterEventService.update(session.user.id, eventId, {
        amount: parsed.data.waterAmount,
        expectedUpdatedAt: parsed.data.expectedUpdatedAt,
        foodLogDate: parsed.data.date,
        localEventTime: parsed.data.waterEventTime,
        selection: parsed.data.waterSelection,
      });
      return redirect(`${foodLogHref(parsed.data.date)}&notice=water-updated`);
    } catch (error) {
      if (error instanceof WaterEventUnavailableError) {
        return data<HomeActionData>(
          { message: error.message, tone: "error" },
          { status: 404 },
        );
      }
      if (error instanceof StaleWaterEventError) {
        return data<HomeActionData>(
          {
            message: error.message,
            tone: "error",
            waterEventEditor: waterEventService.read(
              session.user.id,
              eventId,
            ),
          },
          { status: 409 },
        );
      }
      if (error instanceof InvalidWaterEventInputError) {
        return data<HomeActionData>(
          { message: error.message, tone: "error" },
          { status: 400 },
        );
      }
      throw error;
    }
  }

  if (
    parsed.data.intent === "update-food" ||
    parsed.data.intent === "delete-food"
  ) {
    const entryId = Number(parsed.data.entryId);
    const foodEntryService = getFoodEntryService(testRequestInstant(request));
    try {
      if (parsed.data.intent === "delete-food") {
        foodEntryService.delete(
          session.user.id,
          entryId,
          {
            expectedUpdatedAt: parsed.data.expectedUpdatedAt,
            foodLogDate: parsed.data.date,
          },
        );
        return redirect(`${foodLogHref(parsed.data.date)}&notice=deleted`);
      }
      foodEntryService.update(
        session.user.id,
        entryId,
        {
          carbohydrateGrams: parsed.data.carbohydrateGrams,
          energyKcal: parsed.data.energyKcal,
          expectedUpdatedAt: parsed.data.expectedUpdatedAt,
          fatGrams: parsed.data.fatGrams,
          fiberGrams: parsed.data.fiberGrams,
          foodLogDate: parsed.data.date,
          name: parsed.data.name,
          proteinGrams: parsed.data.proteinGrams,
          quantity: parsed.data.quantity,
          selectedMeasurementId: parsed.data.selectedMeasurementId,
          sodiumMilligrams: parsed.data.sodiumMilligrams,
          sugarGrams: parsed.data.sugarGrams,
        },
      );
      return redirect(`${foodLogHref(parsed.data.date)}&notice=updated`);
    } catch (error) {
      if (error instanceof FoodEntryUnavailableError) {
        return data<HomeActionData>(
          { message: error.message, tone: "error" },
          { status: 404 },
        );
      }
      if (error instanceof StaleFoodEntryError) {
        return data<HomeActionData>(
          {
            foodEntryEditor: foodEntryService.read(session.user.id, entryId),
            message: error.message,
            tone: "error",
          },
          { status: 409 },
        );
      }
      if (error instanceof InvalidFoodEntryInputError) {
        return data<HomeActionData>(
          { message: error.message, tone: "error" },
          { status: 400 },
        );
      }
      throw error;
    }
  }

  if (
    parsed.data.intent === "copy-food-to-today" ||
    parsed.data.intent === "copy-food-to-date"
  ) {
    const entryId = positiveIntegerId(parsed.data.entryId);
    if (entryId === undefined) {
      return data<HomeActionData>(
        { message: "The Food Entry request is invalid", tone: "error" },
        { status: 400 },
      );
    }
    try {
      const foodEntryService = getFoodEntryService(testRequestInstant(request));
      const copyInput = {
        foodLogDate: parsed.data.date,
        idempotencyKey: parsed.data.idempotencyKey,
      };
      const copied =
        parsed.data.intent === "copy-food-to-today"
          ? foodEntryService.copyToToday(session.user.id, entryId, copyInput)
          : foodEntryService.copyToDate(session.user.id, entryId, {
              ...copyInput,
              destinationFoodLogDate: parsed.data.destinationDate,
            });
      const parameters = new URLSearchParams({
        date: parsed.data.date,
        notice: "copied",
        copied: String(copied.id),
      });
      return redirect(`/?${parameters}`);
    } catch (error) {
      if (error instanceof FoodEntryUnavailableError) {
        return data<HomeActionData>(
          { message: error.message, tone: "error" },
          { status: 404 },
        );
      }
      if (error instanceof InvalidFoodEntryInputError) {
        return data<HomeActionData>(
          { message: error.message, tone: "error" },
          { status: 400 },
        );
      }
      return data<HomeActionData>(
        {
          message: "The Food Entry could not be copied. Try again.",
          tone: "error",
        },
        { status: 500 },
      );
    }
  }

  try {
    await getFoodEntryService(testRequestInstant(request)).log(
      session.user.id,
      {
        foodLogDate: parsed.data.date,
        idempotencyKey: parsed.data.idempotencyKey,
        provider: parsed.data.provider,
        providerFoodId: parsed.data.providerFoodId,
        quantity: parsed.data.quantity,
        selectedMeasurementId: parsed.data.selectedMeasurementId,
      },
      catalogContext,
    );
    return redirect(foodLogHref(parsed.data.date));
  } catch (error) {
    if (error instanceof InvalidFoodEntryInputError) {
      return data<HomeActionData>(
        { message: error.message, tone: "error" },
        { status: 400 },
      );
    }
    if (error instanceof CatalogUnknownProviderError) {
      return data<HomeActionData>(
        {
          message: "The selected Food Catalog provider is unavailable.",
          tone: "error",
        },
        { status: 400 },
      );
    }
    const failure =
      parsed.data.provider === "open-food-facts"
        ? barcodeCatalogFailure(error)
        : catalogFailure(error);
    if (failure) {
      return data<HomeActionData>(
        { message: failure.message, tone: "error" },
        { status: failure.status },
      );
    }
    throw error;
  }
}

function foodLogHref(date: string, calendar?: string): string {
  const parameters = new URLSearchParams({ date });
  if (calendar) parameters.set("calendar", calendar);
  return `/?${parameters}`;
}

function copyFoodEntryHref(
  sourceDate: string,
  entryId: number,
  options: { destinationDate?: string; month?: string } = {},
): string {
  const parameters = new URLSearchParams({
    date: sourceDate,
    copy: String(entryId),
  });
  if (options.destinationDate) {
    parameters.set("copyDate", options.destinationDate);
  }
  if (options.month) parameters.set("copyMonth", options.month);
  return `/?${parameters}`;
}

function fullDate(date: string): string {
  return formatLocalDate(date, {
    day: "numeric",
    month: "long",
    weekday: "long",
    year: "numeric",
  });
}

function waterGoalValues(
  waterTargetMicroliters: number,
  displayUnits: DisplayUnits,
) {
  return {
    water: formatWaterAmount(
      waterTargetMicroliters,
      displayUnits,
      3,
    ),
    waterUnit: displayUnits === "metric" ? "ml" : "fl oz",
  };
}

function waterInputValue(
  microliters: number,
  displayUnits: DisplayUnits,
): string {
  const thousandths = waterTargetThousandthsFromMicroliters(
    microliters,
    displayUnits,
  );
  const whole = thousandths / 1_000n;
  const fraction = String(thousandths % 1_000n)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function formatWaterAmount(
  microliters: number,
  displayUnits: DisplayUnits,
  maximumFractionDigits = 3,
): string {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits }).format(
    Number(waterTargetThousandthsFromMicroliters(microliters, displayUnits)) /
      1_000,
  );
}

function CalendarView({
  calendar,
  selectedDate,
}: {
  calendar: NonNullable<Route.ComponentProps["loaderData"]["calendar"]>;
  selectedDate: string;
}) {
  return (
    <section aria-labelledby="history-heading">
      <div className={styles.historyIntro}>
        <div>
          <h2 id="history-heading">History</h2>
          <p>
            Choose any past day. Goal Versions remain tied to their effective
            date.
          </p>
        </div>
        <Link className={styles.backLink} to={foodLogHref(selectedDate)}>
          Back to Food Log
        </Link>
      </div>
      <div className={styles.calendarCard}>
        <div className={styles.calendarHead}>
          <Link
            aria-label="Previous month"
            className={styles.calendarNav}
            to={foodLogHref(selectedDate, calendar.previousMonth)}
          >
            ‹
          </Link>
          <strong>{calendar.label}</strong>
          {calendar.nextMonth ? (
            <Link
              aria-label="Next month"
              className={styles.calendarNav}
              to={foodLogHref(selectedDate, calendar.nextMonth)}
            >
              ›
            </Link>
          ) : (
            <button
              aria-label="Next month"
              className={styles.calendarNavDisabled}
              disabled
              type="button"
            >
              ›
            </button>
          )}
        </div>
        <div
          className={styles.calendarGrid}
          aria-label={`${calendar.label} calendar`}
        >
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <span className={styles.weekday} key={day}>
              {day}
            </span>
          ))}
          {Array.from({ length: calendar.leadingEmptyDays }, (_, index) => (
            // Stryker disable next-line StringLiteral: the opaque prefix does not change the uniqueness of index-based React keys.
            <span aria-hidden="true" key={`empty-${index}`} />
          ))}
          {calendar.days.map((day) => {
            const label = formatLocalDate(day.date, {
              day: "numeric",
              month: "long",
              weekday: "long",
            });
            const className = [
              day.isFuture ? styles.calendarFuture : styles.calendarDay,
              day.isToday ? styles.calendarToday : "",
              day.isSelected ? styles.calendarSelected : "",
            ]
              .filter(Boolean)
              .join(" ");
            return day.isFuture ? (
              <button
                aria-label={label}
                className={className}
                disabled
                key={day.date}
                type="button"
              >
                {day.day}
              </button>
            ) : (
              <Link
                aria-current={day.isSelected ? "date" : undefined}
                aria-label={label}
                className={className}
                key={day.date}
                to={foodLogHref(day.date)}
              >
                {day.day}
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function EmptyActionForm({
  className,
  csrfToken,
  date,
  intent,
  label,
  timelineMarker,
}: {
  className: string;
  csrfToken: string;
  date: string;
  intent: "add-food" | "add-water";
  label: string;
  timelineMarker?: "food" | "water";
}) {
  return (
    <Form method="post">
      <input name="csrfToken" type="hidden" value={csrfToken} />
      <input name="date" type="hidden" value={date} />
      <button
        className={className}
        data-food-dialog-trigger={intent === "add-food" ? true : undefined}
        data-water-dialog-trigger={intent === "add-water" ? true : undefined}
        name="intent"
        type="submit"
        value={intent}
      >
        {timelineMarker ? (
          <>
            <span
              aria-hidden="true"
              className={`${styles.timelineActionMarker} ${
                timelineMarker === "food"
                  ? styles.timelineActionFood
                  : styles.timelineActionWater
              }`}
            >
              <UiIcon name="plus" />
            </span>
            <span>{label}</span>
          </>
        ) : (
          label
        )}
      </button>
    </Form>
  );
}

function catalogHref(date: string, food: string, query?: string): string {
  const parameters = new URLSearchParams({ date, food });
  if (query) parameters.set("query", query);
  return `/?${parameters}`;
}

// Stryker disable BlockStatement,ObjectLiteral,StringLiteral: the mobile browser scan journey asserts the exact recognized-barcode destination and one resulting lookup request.
function barcodeCatalogHref(date: string, barcode: string): string {
  const parameters = new URLSearchParams({ barcode, date, food: "barcode" });
  return `/?${parameters}`;
}
// Stryker restore BlockStatement,ObjectLiteral,StringLiteral

function formatEnergy(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(
    value / 1_000,
  );
}

function formatCanonicalNutrient(value: number, unit: "g" | "mg"): string {
  // Stryker disable ObjectLiteral,ConditionalExpression: stored integer milligrams have at most three fractional gram digits and no fractional milligram digits, matching Intl defaults exactly.
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: unit === "g" ? 3 : 0,
  }).format(unit === "g" ? value / 1_000 : value);
  // Stryker restore ObjectLiteral,ConditionalExpression
}

function progressStyle(known: number, goal: number): CSSProperties {
  const percentage = Math.min(100, (known / goal) * 100);
  return { "--progress": `${percentage}%` } as CSSProperties;
}

type NutritionMetric = {
  goal: number | null;
  goalKind: "maximum" | "target";
  isIncomplete: boolean;
  key: string;
  known: number;
  label: string;
  unit: "g" | "mg";
};

function NutrientMetric({ metric }: { metric: NutritionMetric }) {
  const known = formatCanonicalNutrient(metric.known, metric.unit);
  const goal =
    metric.goal === null
      ? null
      : formatCanonicalNutrient(metric.goal, metric.unit);
  const knownDescription = metric.isIncomplete ? `${known} known` : known;
  const description =
    metric.goal === null
      ? `${metric.label}: ${knownDescription}; no active ${metric.goalKind}${metric.isIncomplete ? "; incomplete" : ""}`
      : `${metric.label}: ${knownDescription} of ${goal} ${metric.unit} ${metric.goalKind}${metric.isIncomplete ? "; incomplete" : ""}`;

  return (
    <article aria-label={description} className={styles.nutrientCell}>
      <span>
        {metric.label}
        {metric.goalKind === "maximum" ? " max" : ""}
      </span>
      <strong>
        {knownDescription}{" "}
        <small>
          {goal === null ? "/ No active goal" : `/ ${goal} ${metric.unit}`}
        </small>
      </strong>
      {metric.goal === null ? null : (
        <div
          aria-label={`${metric.label} progress`}
          aria-valuemax={
            metric.unit === "g" ? metric.goal / 1_000 : metric.goal
          }
          aria-valuemin={0}
          aria-valuenow={Math.min(
            metric.unit === "g" ? metric.known / 1_000 : metric.known,
            metric.unit === "g" ? metric.goal / 1_000 : metric.goal,
          )}
          aria-valuetext={description}
          className={styles.nutrientProgress}
          role="progressbar"
          style={progressStyle(metric.known, metric.goal)}
        >
          <span />
        </div>
      )}
      {metric.isIncomplete ? <em>Incomplete</em> : null}
    </article>
  );
}

function DailySummary({
  foodLog,
}: {
  foodLog: Route.ComponentProps["loaderData"]["foodLog"];
}) {
  const [nutrientDragX, setNutrientDragX] = useState(0);
  const [nutrientPage, setNutrientPage] = useState(0);
  const [nutrientSettling, setNutrientSettling] = useState(false);
  const nutrientSwipe = useRef<{
    isHorizontal: boolean;
    pointerId: number;
    startX: number;
    startY: number;
    width: number;
  } | null>(null);

  function startNutrientSwipe(event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType !== "touch") return;
    setNutrientSettling(false);
    nutrientSwipe.current = {
      isHorizontal: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: event.currentTarget.getBoundingClientRect().width,
    };
  }

  function moveNutrientSwipe(event: ReactPointerEvent<HTMLElement>) {
    const swipe = nutrientSwipe.current;
    if (!swipe || event.pointerId !== swipe.pointerId) return;

    const horizontalDistance = event.clientX - swipe.startX;
    const verticalDistance = event.clientY - swipe.startY;
    if (!swipe.isHorizontal) {
      if (
        Math.abs(horizontalDistance) < 6 &&
        Math.abs(verticalDistance) < 6
      ) {
        return;
      }
      if (Math.abs(horizontalDistance) <= Math.abs(verticalDistance)) {
        nutrientSwipe.current = null;
        return;
      }
      swipe.isHorizontal = true;
    }

    event.preventDefault();
    const minimum =
      nutrientPage === metricPages.length - 1 ? 0 : -swipe.width;
    const maximum = nutrientPage === 0 ? 0 : swipe.width;
    setNutrientDragX(
      Math.max(minimum, Math.min(maximum, horizontalDistance)),
    );
  }

  function cancelNutrientSwipe() {
    nutrientSwipe.current = null;
    setNutrientDragX(0);
    setNutrientSettling(true);
  }

  function finishNutrientSwipe(event: ReactPointerEvent<HTMLElement>) {
    const swipe = nutrientSwipe.current;
    nutrientSwipe.current = null;
    if (
      !swipe ||
      event.pointerId !== swipe.pointerId ||
      !swipe.isHorizontal
    ) {
      return;
    }

    const horizontalDistance = event.clientX - swipe.startX;
    const shouldChangePage =
      Math.abs(horizontalDistance) >= Math.min(64, swipe.width * 0.2);
    if (shouldChangePage) {
      setNutrientPage((page) =>
        // Stryker disable next-line EqualityOperator: shouldChangePage proves the distance is nonzero because its threshold is positive.
        horizontalDistance < 0
          ? Math.min(page + 1, metricPages.length - 1)
          : Math.max(page - 1, 0),
      );
    }
    setNutrientDragX(0);
    setNutrientSettling(true);
  }

  const goal = foodLog.goal;
  const goals = goal
    ? waterGoalValues(goal.waterTargetMicroliters, foodLog.displayUnits)
    : undefined;
  const totals = foodLog.nutritionTotals;
  const calorieTotal = totals.energyMilliKcal;
  const calorieGoal = goal?.calorieTargetMilliKcal;
  const calorieKnown = formatEnergy(calorieTotal.known);
  const calorieGoalDisplay = calorieGoal ? formatEnergy(calorieGoal) : undefined;
  const waterTotal = foodLog.waterTotalMicroliters;
  const waterTotalDisplay = formatWaterAmount(
    waterTotal,
    foodLog.displayUnits,
    3,
  );
  const waterUnit = foodLog.displayUnits === "metric" ? "ml" : "fl oz";
  const equivalentGlasses = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
  }).format(waterTotal / 236_588.236_5);
  const calorieDescription = calorieGoal
    ? `${calorieKnown}${calorieTotal.isIncomplete ? " known" : ""} of ${calorieGoalDisplay} kcal target${calorieTotal.isIncomplete ? "; incomplete" : ""}`
    : undefined;
  const metricPages: NutritionMetric[][] = [
    [
      {
        goal: goal?.proteinTargetMilligrams ?? null,
        goalKind: "target",
        isIncomplete: totals.proteinMilligrams.isIncomplete,
        // Stryker disable next-line StringLiteral: this opaque React key is already unique within its fixed list.
        key: "protein",
        known: totals.proteinMilligrams.known,
        label: "Protein",
        unit: "g",
      },
      {
        goal: goal?.carbohydrateTargetMilligrams ?? null,
        goalKind: "target",
        isIncomplete: totals.carbohydrateMilligrams.isIncomplete,
        // Stryker disable next-line StringLiteral: this opaque React key is already unique within its fixed list.
        key: "carbohydrate",
        known: totals.carbohydrateMilligrams.known,
        label: "Carbohydrate",
        unit: "g",
      },
      {
        goal: goal?.fatTargetMilligrams ?? null,
        goalKind: "target",
        isIncomplete: totals.fatMilligrams.isIncomplete,
        // Stryker disable next-line StringLiteral: this opaque React key is already unique within its fixed list.
        key: "fat",
        known: totals.fatMilligrams.known,
        label: "Fat",
        unit: "g",
      },
    ],
    [
      {
        goal: goal?.fiberTargetMilligrams ?? null,
        goalKind: "target",
        isIncomplete: totals.fiberMilligrams.isIncomplete,
        // Stryker disable next-line StringLiteral: this opaque React key is already unique within its fixed list.
        key: "fiber",
        known: totals.fiberMilligrams.known,
        label: "Fiber",
        unit: "g",
      },
      {
        goal: goal?.sugarMaximumMilligrams ?? null,
        goalKind: "maximum",
        isIncomplete: totals.sugarMilligrams.isIncomplete,
        // Stryker disable next-line StringLiteral: this opaque React key is already unique within its fixed list.
        key: "sugar",
        known: totals.sugarMilligrams.known,
        label: "Sugar",
        unit: "g",
      },
      {
        goal: goal?.sodiumMaximumMilligrams ?? null,
        goalKind: "maximum",
        isIncomplete: totals.sodiumMilligrams.isIncomplete,
        // Stryker disable next-line StringLiteral: this opaque React key is already unique within its fixed list.
        key: "sodium",
        known: totals.sodiumMilligrams.known,
        label: "Sodium",
        unit: "mg",
      },
    ],
  ];
  const nutrientTrackStyle = {
    transform: `translate3d(calc(${-nutrientPage * 50}% + ${nutrientDragX}px), 0, 0)`,
  } satisfies CSSProperties;

  return (
    <>
      <section
        aria-labelledby="calorie-heading"
        className={styles.summarySurface}
      >
        <div className={styles.calorieRow}>
          <h2 id="calorie-heading">Calories</h2>
          <p>
            <strong>
              {calorieKnown}
              {calorieTotal.isIncomplete ? " known" : ""}
            </strong>{" "}
            <span>
              {calorieGoal
                ? `/ ${calorieGoalDisplay} kcal`
                : "/ No active goal"}
            </span>
          </p>
          {calorieGoal ? (
            <div
              aria-label="Calorie progress"
              aria-valuemax={calorieGoal / 1_000}
              aria-valuemin={0}
              aria-valuenow={Math.min(
                calorieTotal.known / 1_000,
                calorieGoal / 1_000,
              )}
              aria-valuetext={calorieDescription}
              className={styles.linearProgress}
              role="progressbar"
              style={progressStyle(calorieTotal.known, calorieGoal)}
            >
              <span />
            </div>
          ) : null}
          <small>
            {calorieTotal.isIncomplete ? (
              <em className={styles.incompleteLabel}>Incomplete</em>
            ) : null}
            {calorieTotal.isIncomplete ? " · " : ""}
            {foodLog.entries.length
              ? `${foodLog.entries.length} Food ${foodLog.entries.length === 1 ? "Entry" : "Entries"}`
              : "No Food Entries"}
          </small>
        </div>

        <section
          aria-label="Daily nutrient progress"
          className={styles.nutrientCarousel}
          onPointerCancel={cancelNutrientSwipe}
          onPointerDown={startNutrientSwipe}
          onPointerMove={moveNutrientSwipe}
          onPointerUp={finishNutrientSwipe}
        >
          <div
            className={`${styles.nutrientTrack} ${nutrientSettling ? styles.nutrientTrackSettling : ""}`}
            style={nutrientTrackStyle}
          >
            {metricPages.map((metrics, page) => (
              <div
                aria-hidden={nutrientPage !== page}
                className={styles.nutrientPage}
                key={page}
              >
                {metrics.map((metric) => (
                  <NutrientMetric key={metric.key} metric={metric} />
                ))}
              </div>
            ))}
          </div>
          <div
            aria-label="Nutrition pages"
            className={styles.carouselControls}
            role="group"
          >
            <button
              aria-label="Show protein, carbohydrate, and fat"
              aria-pressed={nutrientPage === 0}
              className={`${styles.carouselDot} ${nutrientPage === 0 ? styles.activeCarouselDot : ""}`}
              onClick={() => {
                setNutrientSettling(false);
                setNutrientPage(0);
              }}
              type="button"
            />
            <button
              aria-label="Show fiber, sugar, and sodium"
              aria-pressed={nutrientPage === 1}
              className={`${styles.carouselDot} ${nutrientPage === 1 ? styles.activeCarouselDot : ""}`}
              onClick={() => {
                setNutrientSettling(false);
                setNutrientPage(1);
              }}
              type="button"
            />
          </div>
        </section>
      </section>

      <section
        aria-labelledby="water-heading"
        className={styles.waterOverview}
      >
        <Link
          className={styles.waterOverviewRow}
          data-water-dialog-trigger
          to={`${foodLogHref(foodLog.selectedDate)}&water=new`}
        >
          <span>
            <strong id="water-heading">Water</strong>
            <small>
              {equivalentGlasses} equivalent {equivalentGlasses === "1" ? "glass" : "glasses"} · 8 fl oz / 237 ml
            </small>
          </span>
          <strong>
            {waterTotalDisplay}{" "}
            <small>
              {goal ? `/ ${goals!.water} ${goals!.waterUnit}` : "/ No active goal"}
            </small>
          </strong>
          <span aria-hidden="true">›</span>
        </Link>
        {goal ? (
          <div
            aria-label="Water progress"
            aria-valuemax={
              foodLog.displayUnits === "metric"
                ? goal.waterTargetMicroliters / 1_000
                : goal.waterTargetMicroliters / 29_573.529_562_5
            }
            aria-valuemin={0}
            aria-valuenow={Math.min(
              foodLog.displayUnits === "metric"
                ? waterTotal / 1_000
                : waterTotal / 29_573.529_562_5,
              foodLog.displayUnits === "metric"
                ? goal.waterTargetMicroliters / 1_000
                : goal.waterTargetMicroliters / 29_573.529_562_5,
            )}
            aria-valuetext={`${waterTotalDisplay} of ${goals!.water} ${waterUnit} target`}
            className={styles.waterProgress}
            role="progressbar"
            style={progressStyle(waterTotal, goal.waterTargetMicroliters)}
          >
            <span />
          </div>
        ) : null}
      </section>
    </>
  );
}

function DesktopDayContext({
  foodLog,
  isObscured,
}: {
  foodLog: Route.ComponentProps["loaderData"]["foodLog"];
  isObscured: boolean;
}) {
  const goal = foodLog.goal;
  const calorieTotal = foodLog.nutritionTotals.energyMilliKcal;
  const calorieGoal = goal?.calorieTargetMilliKcal ?? null;
  const goals = goal
    ? waterGoalValues(goal.waterTargetMicroliters, foodLog.displayUnits)
    : undefined;
  const waterTotal = foodLog.waterTotalMicroliters;
  const waterTotalDisplay = formatWaterAmount(
    waterTotal,
    foodLog.displayUnits,
    3,
  );
  const selectedDay = formatLocalDate(foodLog.selectedDate, {
    day: "numeric",
    month: "short",
    weekday: "short",
  }).replace(",", " ·");

  return (
    <aside
      aria-hidden={isObscured || undefined}
      aria-label="Selected day context"
      className={styles.desktopContext}
    >
      <div className={styles.contextHead}>
        <span>Selected day</span>
        <strong>{selectedDay}</strong>
        <small className={styles.contextTimeZone}>{foodLog.timeZone}</small>
      </div>
      <div className={styles.contextMetric}>
        <span>Calories</span>
        <strong>
          {formatEnergy(calorieTotal.known)}{" "}
          {calorieGoal ? (
            <small className={styles.contextGoal}>
              {formatEnergy(calorieGoal)} kcal
            </small>
          ) : (
            <small>No goal</small>
          )}
        </strong>
        {calorieGoal ? (
          <i style={progressStyle(calorieTotal.known, calorieGoal)}>
            <span />
          </i>
        ) : null}
      </div>
      <div className={`${styles.contextMetric} ${styles.waterContext}`}>
        <span>Water</span>
        <strong>
          {waterTotalDisplay}{" "}
          {goal ? (
            <small className={styles.contextGoal}>
              {goals!.water} {goals!.waterUnit}
            </small>
          ) : (
            <small>No goal</small>
          )}
        </strong>
        {goal ? (
          <i style={progressStyle(waterTotal, goal.waterTargetMicroliters)}>
            <span />
          </i>
        ) : null}
      </div>
      <div className={styles.contextNote}>
        <UiIcon name="info" />
        <p>
          <strong>Nutrition Snapshot</strong>
          Existing Food Entries keep their saved provider values even when
          USDA changes later.
        </p>
      </div>
      <a
        aria-label="USDA FoodData Central source"
        className={styles.contextSource}
        href="https://fdc.nal.usda.gov/"
        rel="noreferrer"
        target="_blank"
      >
        USDA FoodData Central <UiIcon name="external" />
      </a>
    </aside>
  );
}

function formatEventTime(value: string): string {
  const [hour, minute] = value.split(":").map(Number);
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function FoodDetailSkeleton() {
  return (
    <div
      aria-label="Loading food details"
      aria-live="polite"
      className={styles.foodDetailSkeleton}
      role="status"
    >
      <span className={styles.pendingLabel}>Loading food details…</span>
      <div className={styles.skeletonBackLink} />
      <div className={styles.skeletonIdentity}>
        <span className={styles.skeletonChip} />
        <span className={styles.skeletonTitle} />
        <span className={styles.skeletonText} />
      </div>
      <div className={styles.skeletonNote} />
      <div className={styles.skeletonFieldGrid}>
        <span className={styles.skeletonField} />
        <span className={styles.skeletonField} />
      </div>
      <div className={styles.skeletonNutritionGrid}>
        {Array.from({ length: 4 }, (_, index) => (
          <span className={styles.skeletonNutrition} key={index} />
        ))}
      </div>
      <div className={styles.skeletonActions}>
        <span />
        <span />
      </div>
    </div>
  );
}

function CatalogNutritionPreview({
  carbohydrateLabel = "Carbohydrate",
  food,
  includeAdditional = false,
  multiplier,
}: {
  carbohydrateLabel?: string;
  food: CatalogFood;
  includeAdditional?: boolean;
  multiplier: number;
}) {
  const nutrition = food.nutritionPerAuthoritativeBase;
  const fields: Array<
    [string, CatalogNutrientValue | null, number, string]
  > = [
    ["Calories", nutrition.energyMilliKcal, 1_000, "kcal"],
    ["Protein", nutrition.proteinMilligrams, 1_000, "g"],
    [carbohydrateLabel, nutrition.carbohydrateMilligrams, 1_000, "g"],
    ["Fat", nutrition.fatMilligrams, 1_000, "g"],
  ];
  if (includeAdditional) {
    fields.push(
      ["Fiber", nutrition.fiberMilligrams, 1_000, "g"],
      ["Sugar", nutrition.sugarMilligrams, 1_000, "g"],
      ["Sodium", nutrition.sodiumMilligrams, 1, "mg"],
    );
  }
  return (
    <dl className={styles.nutritionPreview}>
      {fields.map(([label, value, divisor, unit]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd>
            {value === null
              ? "Not reported"
              : `${new Intl.NumberFormat("en-US", {
                  maximumFractionDigits: 1,
                }).format(
                  (value.amount * value.fixedPointMultiplier * multiplier) /
                    divisor,
                )} ${unit}`}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function FoodDetailStage({
  actionData,
  catalog,
  csrfToken,
  date,
}: {
  actionData: HomeActionData | undefined;
  catalog: Extract<
    NonNullable<Route.ComponentProps["loaderData"]["catalog"]>,
    { mode: "detail" }
  >;
  csrfToken: string;
  date: string;
}) {
  const { food } = catalog;
  const [measurementId, setMeasurementId] = useState(
    food.measurements[0]?.id ?? "",
  );
  const [quantity, setQuantity] = useState("1");
  const measurement =
    food.measurements.find((candidate) => candidate.id === measurementId) ??
    food.measurements[0];
  const numericQuantity = Number(quantity);
  const multiplier =
    // Stryker disable next-line EqualityOperator: accepting zero still produces the identical zero multiplier.
    measurement && Number.isFinite(numericQuantity) && numericQuantity > 0
      ? (measurement.baseQuantityMicrounits /
          food.authoritativeBaseQuantityMicrounits) *
        numericQuantity
      : 0;
  return (
    <>
      <Link
        className={styles.backToResults}
        to={catalogHref(date, "search", catalog.query)}
      >
        ‹ Back to results
      </Link>
      <div className={styles.foodIdentity}>
        <span className={styles.catalogType}>{food.dataType}</span>
        <h3>{food.name}</h3>
        <p>
          USDA FoodData Central
          {food.brand ? ` · ${food.brand}` : ""}
        </p>
      </div>
      <div className={styles.snapshotNote}>
        <span aria-hidden="true">◇</span>
        <p>
          <strong>Saved as a Nutrition Snapshot</strong>
          This entry keeps these values and source details if USDA later changes
          or is unavailable.
        </p>
      </div>
      <Form className={styles.logFoodForm} method="post">
        <input name="csrfToken" type="hidden" value={csrfToken} />
        <input name="date" type="hidden" value={date} />
        <input
          name="idempotencyKey"
          type="hidden"
          value={catalog.idempotencyKey}
        />
        <input name="intent" type="hidden" value="log-food" />
        <input name="provider" type="hidden" value={food.provider} />
        <input
          name="providerFoodId"
          type="hidden"
          value={food.providerFoodId}
        />
        <div className={styles.foodDetailGrid}>
          <label className={styles.stackedField}>
            <span>Measurement</span>
            <select
              name="selectedMeasurementId"
              onChange={(event) => setMeasurementId(event.currentTarget.value)}
              value={measurementId}
            >
              {food.measurements.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </option>
              ))}
            </select>
            <small>Only provider-backed conversions are shown.</small>
          </label>
          <label className={styles.stackedField}>
            <span>Quantity</span>
            <input
              inputMode="decimal"
              max="99"
              min="0.01"
              name="quantity"
              onChange={(event) => setQuantity(event.currentTarget.value)}
              required
              step="0.01"
              type="number"
              value={quantity}
            />
          </label>
        </div>
        <CatalogNutritionPreview food={food} multiplier={multiplier} />
        {actionData?.message ? (
          <p className={styles.catalogError} role="alert">
            {actionData.message}
          </p>
        ) : null}
        <div className={styles.dialogActions}>
          <Link className={styles.secondaryButton} to={foodLogHref(date)}>
            Cancel
          </Link>
          <button className={styles.primaryButton} type="submit">
            Add to Food Log
          </button>
        </div>
      </Form>
    </>
  );
}

type EditableFoodEntry = NonNullable<
  Route.ComponentProps["loaderData"]["foodEntryEditor"]
>;

type FoodEntryFields = {
  carbohydrateGrams: string;
  energyKcal: string;
  fatGrams: string;
  fiberGrams: string;
  name: string;
  proteinGrams: string;
  quantity: string;
  selectedMeasurementId: string;
  sodiumMilligrams: string;
  sugarGrams: string;
};

const FOOD_NUTRIENT_FIELDS = [
  ["energyKcal", "Calories (kcal)"],
  ["proteinGrams", "Protein (g)"],
  ["carbohydrateGrams", "Carbohydrate (g)"],
  ["fatGrams", "Fat (g)"],
  ["fiberGrams", "Fiber (g)"],
  ["sugarGrams", "Sugar (g)"],
  ["sodiumMilligrams", "Sodium (mg)"],
] as const;

function storedNutrientInput(
  value: number | null,
  integerMilligrams = false,
) {
  if (value === null) return "";
  if (integerMilligrams) return String(value);
  const whole = Math.floor(value / 1_000);
  const fraction = String(value % 1_000)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function initialFoodEntryFields(entry: EditableFoodEntry): FoodEntryFields {
  return {
    carbohydrateGrams: storedNutrientInput(
      entry.carbohydrateMilligrams,
    ),
    energyKcal: storedNutrientInput(
      entry.energyMilliKcal,
    ),
    fatGrams: storedNutrientInput(
      entry.fatMilligrams,
    ),
    fiberGrams: storedNutrientInput(
      entry.fiberMilligrams,
    ),
    name: entry.name,
    proteinGrams: storedNutrientInput(
      entry.proteinMilligrams,
    ),
    quantity: String(entry.quantityMicrounits / 1_000_000),
    selectedMeasurementId: entry.selectedMeasurementId,
    sodiumMilligrams: storedNutrientInput(
      entry.sodiumMilligrams,
      true,
    ),
    sugarGrams: storedNutrientInput(
      entry.sugarMilligrams,
    ),
  };
}

function recalculatedFoodEntryFields(
  entry: EditableFoodEntry,
  selectedMeasurementId: string,
  quantity: string,
): Partial<FoodEntryFields> {
  const measurement = entry.supportedMeasurements.find(
    (candidate) => candidate.id === selectedMeasurementId,
  );
  const quantityMicrounits = quantityMicrounitsFromDecimal(quantity);
  if (!measurement || quantityMicrounits === undefined) return {};
  const scale = (
    value: EditableFoodEntry["authoritativeNutrition"]["energyMilliKcal"],
  ) =>
    scaleCatalogNutrient(
      value,
      measurement.baseQuantityMicrounits,
      quantityMicrounits,
      entry.authoritativeBaseQuantityMicrounits,
    );
  return {
    carbohydrateGrams: storedNutrientInput(
      scale(entry.authoritativeNutrition.carbohydrateMilligrams),
    ),
    energyKcal: storedNutrientInput(
      scale(entry.authoritativeNutrition.energyMilliKcal),
    ),
    fatGrams: storedNutrientInput(
      scale(entry.authoritativeNutrition.fatMilligrams),
    ),
    fiberGrams: storedNutrientInput(
      scale(entry.authoritativeNutrition.fiberMilligrams),
    ),
    proteinGrams: storedNutrientInput(
      scale(entry.authoritativeNutrition.proteinMilligrams),
    ),
    sodiumMilligrams: storedNutrientInput(
      scale(entry.authoritativeNutrition.sodiumMilligrams),
      true,
    ),
    sugarGrams: storedNutrientInput(
      scale(entry.authoritativeNutrition.sugarMilligrams),
    ),
  };
}

function useModalDialog({
  closeHref,
  initialFocusSelector,
  restoreFocusSelector,
}: {
  closeHref: string;
  initialFocusSelector: string;
  restoreFocusSelector: string;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const navigate = useNavigate();
  const previousFocusRef = useRef<HTMLElement | null>(null);

  // Stryker disable ConditionalExpression,LogicalOperator,BooleanLiteral,BlockStatement,OptionalChaining,CallExpression,ArrayDeclaration: browser focus/cleanup behavior is covered directly; remaining variants are defensive DOM-null and one-shot-effect equivalents.
  useEffect(() => {
    if (
      !previousFocusRef.current &&
      document.activeElement instanceof HTMLElement
    ) {
      previousFocusRef.current = document.activeElement;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = requestAnimationFrame(() => {
      dialogRef.current
        ?.querySelector<HTMLElement>(initialFocusSelector)
        ?.focus();
    });
    return () => {
      cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      const previousFocus = previousFocusRef.current;
      requestAnimationFrame(() => {
        const restoreTarget =
          previousFocus?.isConnected && previousFocus !== document.body
            ? previousFocus
            : document.querySelector<HTMLElement>(restoreFocusSelector);
        restoreTarget?.focus();
      });
    };
  }, [initialFocusSelector, restoreFocusSelector]);
  // Stryker restore ConditionalExpression,LogicalOperator,BooleanLiteral,BlockStatement,OptionalChaining,CallExpression,ArrayDeclaration

  function closeDialog() {
    void navigate(closeHref);
  }

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (event.key !== "Tab") return;
    // Stryker disable MethodExpression,OptionalChaining,ArrayDeclaration,ConditionalExpression: the dialog-ref and visible-element browser invariants are exercised by the keyboard focus-loop tests.
    const focusable = [
      ...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), a[href]',
      ) ?? []),
    ].filter((element) => element.offsetParent !== null);
    // Stryker restore MethodExpression,OptionalChaining,ArrayDeclaration,ConditionalExpression
    const first = focusable[0];
    const last = focusable.at(-1);
    // Stryker disable next-line ConditionalExpression,LogicalOperator: rendered dialogs always contain tested visible controls.
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return { closeDialog, dialogRef, handleDialogKeyDown };
}

function DialogBackdrop({
  children,
  onClose,
}: {
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div
      className={styles.dialogBackdrop}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {children}
    </div>
  );
}

function FoodEntryEditorDialog({
  actionData,
  csrfToken,
  entry,
  photoMeal,
}: {
  actionData: HomeActionData | undefined;
  csrfToken: string;
  photoMeal?: Route.ComponentProps["loaderData"]["photoMeals"][number];
  entry: EditableFoodEntry;
}) {
  const navigation = useNavigation();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [fields, setFields] = useState(() => initialFoodEntryFields(entry));
  const closeHref = foodLogHref(entry.foodLogDate);
  const { closeDialog, dialogRef, handleDialogKeyDown } = useModalDialog({
    closeHref,
    initialFocusSelector: "input:not([disabled])",
    restoreFocusSelector: "[data-entry-editor-trigger]",
  });
  const pending = navigation.formData?.get("entryId") === String(entry.id);
  const pendingIntent = pending
    ? navigation.formData!.get("intent")
    : undefined;

  useEffect(() => {
    if (!confirmingDelete) return;
    const confirmDeleteButton = dialogRef.current?.querySelector<HTMLButtonElement>(
      'button[name="intent"][value="delete-food"]',
    );
    confirmDeleteButton?.focus({ preventScroll: true });
    confirmDeleteButton?.scrollIntoView?.({ block: "nearest" });
  }, [confirmingDelete, dialogRef]);

  function changeScale(selectedMeasurementId: string, quantity: string) {
    setFields((current) => ({
      ...current,
      ...recalculatedFoodEntryFields(entry, selectedMeasurementId, quantity),
      quantity,
      selectedMeasurementId,
    }));
  }

  return (
    <DialogBackdrop onClose={closeDialog}>
      <section
        aria-labelledby="edit-food-entry-title"
        aria-modal="true"
        className={`${styles.foodDialog} ${styles.editFoodDialog}`}
        onKeyDown={handleDialogKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <div className={styles.dialogHead}>
          <div>
            <h2 id="edit-food-entry-title">Edit Food Entry</h2>
            <span className={styles.dialogChip}>Nutrition Snapshot</span>
            <p>Changes affect this occurrence only.</p>
          </div>
          <Link
            aria-label="Close edit form"
            className={styles.dialogClose}
            to={closeHref}
          >
            ×
          </Link>
        </div>
        {photoMeal ? <PhotoCorrection meal={photoMeal} csrfToken={csrfToken} /> : null}
        <Form className={styles.editFoodForm} method="post" noValidate>
          <input name="csrfToken" type="hidden" value={csrfToken} />
          <input name="date" type="hidden" value={entry.foodLogDate} />
          <input name="entryId" type="hidden" value={entry.id} />
          <input
            name="expectedUpdatedAt"
            type="hidden"
            value={entry.updatedAt}
          />
          <fieldset disabled={pending}>
            <label className={styles.stackedField}>
              <span>Food name</span>
              <input
                maxLength={200}
                name="name"
                onChange={(event) =>
                  setFields((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                required
                value={fields.name}
              />
            </label>
            <div className={styles.foodDetailGrid}>
              <label className={styles.stackedField}>
                <span>Measurement</span>
                <select
                  name="selectedMeasurementId"
                  onChange={(event) =>
                    changeScale(event.target.value, fields.quantity)
                  }
                  value={fields.selectedMeasurementId}
                >
                  {entry.supportedMeasurements.map((measurement) => (
                    <option key={measurement.id} value={measurement.id}>
                      {measurement.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.stackedField}>
                <span>Quantity</span>
                <input
                  inputMode="decimal"
                  max="99"
                  min="0.000001"
                  name="quantity"
                  onChange={(event) =>
                    changeScale(fields.selectedMeasurementId, event.target.value)
                  }
                  required
                  step="0.000001"
                  type="number"
                  value={fields.quantity}
                />
              </label>
            </div>
            <div className={styles.editNutritionGrid}>
              {FOOD_NUTRIENT_FIELDS.map(([name, label]) => (
                <label className={styles.stackedField} key={name}>
                  <span>{label}</span>
                  <input
                    inputMode="decimal"
                    max={name === "sodiumMilligrams" ? "9999999" : "999999.999"}
                    min="0"
                    name={name}
                    onChange={(event) =>
                      setFields((current) => ({
                        ...current,
                        [name]: event.target.value,
                      }))
                    }
                    required={
                      entry.provider === "manual" && name === "energyKcal"
                        ? true
                        : undefined
                    }
                    step={name === "sodiumMilligrams" ? "1" : "0.001"}
                    type="number"
                    value={fields[name]}
                  />
                </label>
              ))}
            </div>
            <p className={styles.authoritativeNote}>
              Quantity and measurement recalculate from the saved authoritative
              base, not from previously rounded values. Empty nutrients save as
              unknown; zero remains a known zero.
            </p>
            {actionData?.message ? (
              <p className={styles.catalogError} role="alert">
                {actionData.message}
              </p>
            ) : null}
            <div className={styles.editActions}>
              <button
                className={styles.dangerButton}
                onClick={() => setConfirmingDelete(true)}
                type="button"
              >
                Delete entry
              </button>
              <div>
                <Link className={styles.secondaryButton} to={closeHref}>
                  Cancel
                </Link>
                <button
                  className={styles.primaryButton}
                  name="intent"
                  type="submit"
                  value="update-food"
                >
                  {pendingIntent === "update-food"
                    ? "Saving…"
                    : "Save changes"}
                </button>
              </div>
            </div>
            {confirmingDelete ? (
              <div className={styles.deleteConfirm} role="alert">
                <div>
                  <strong>Delete this Food Entry?</strong>
                  <p>Its nutrition will no longer contribute to this day.</p>
                </div>
                <button
                  className={styles.secondaryButton}
                  onClick={() => setConfirmingDelete(false)}
                  type="button"
                >
                  Keep it
                </button>
                <button
                  className={styles.dangerSubmitButton}
                  formNoValidate
                  name="intent"
                  type="submit"
                  value="delete-food"
                >
                  {pendingIntent === "delete-food" ? "Deleting…" : "Delete"}
                </button>
              </div>
            ) : null}
          </fieldset>
        </Form>
      </section>
    </DialogBackdrop>
  );
}

type WaterDialogState = NonNullable<
  Route.ComponentProps["loaderData"]["waterDialog"]
>;

const waterPresetMicroliters = {
  "8": 236_588,
  "16": 473_176,
  "24": 709_765,
} as const;

function WaterEventDialog({
  actionData,
  csrfToken,
  date,
  dialog,
  displayUnits,
}: {
  actionData: HomeActionData | undefined;
  csrfToken: string;
  date: string;
  dialog: WaterDialogState;
  displayUnits: DisplayUnits;
}) {
  // Stryker disable next-line ConditionalExpression: create-mode dialogs have no event property, so forcing the edit arm still yields undefined.
  const event = dialog.mode === "edit" ? dialog.event : undefined;
  const matchingPreset = event
    ? (Object.entries(waterPresetMicroliters).find(
        ([, microliters]) => microliters === event.amountMicroliters,
      )?.[0] as "8" | "16" | "24" | undefined)
    : "8";
  const [selection, setSelection] = useState<"8" | "16" | "24" | "exact">(
    matchingPreset ?? "exact",
  );
  const [amount, setAmount] = useState(
    event
      ? waterInputValue(event.amountMicroliters, displayUnits)
      : displayUnits === "metric"
        ? "355"
        : "12",
  );
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const navigation = useNavigation();
  const closeHref = foodLogHref(date);
  const { closeDialog, dialogRef, handleDialogKeyDown } = useModalDialog({
    closeHref,
    initialFocusSelector: "button:not([disabled])",
    restoreFocusSelector:
      "[data-water-editor-trigger], [data-water-dialog-trigger]",
  });
  const unit = displayUnits === "metric" ? "ml" : "fl oz";
  const pending = event
    ? navigation.formData?.get("eventId") === String(event.id)
    : navigation.formData?.get("intent") === "create-water";
  const pendingIntent = pending ? navigation.formData!.get("intent") : undefined;

  const presets = [
    { label: "Glass", selection: "8" as const },
    { label: "Bottle", selection: "16" as const },
    { label: "Large", selection: "24" as const },
  ];

  return (
    <DialogBackdrop onClose={closeDialog}>
      <section
        aria-labelledby="water-event-title"
        aria-modal="true"
        className={`${styles.foodDialog} ${styles.waterDialog}`}
        onKeyDown={handleDialogKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <div className={styles.dialogHead}>
          <div>
            <h2 id="water-event-title">
              {event ? "Edit Water Event" : "Add Water"}
            </h2>
            <p>Exact plain-water amount</p>
          </div>
          <Link
            aria-label="Close water sheet"
            className={styles.dialogClose}
            to={closeHref}
          >
            ×
          </Link>
        </div>
        <Form className={styles.waterForm} method="post" noValidate>
          <input name="csrfToken" type="hidden" value={csrfToken} />
          <input name="date" type="hidden" value={date} />
          <input name="waterSelection" type="hidden" value={selection} />
          {selection === "exact" ? null : (
            <input name="waterAmount" type="hidden" value="" />
          )}
          {event ? (
            <>
              <input name="eventId" type="hidden" value={event.id} />
              <input
                name="expectedUpdatedAt"
                type="hidden"
                value={event.updatedAt}
              />
            </>
          ) : null}
          <fieldset disabled={pending}>
            <div aria-label="Water presets" className={styles.waterPresets}>
              {presets.map((preset) => (
                <button
                  aria-pressed={selection === preset.selection}
                  className={styles.waterPresetButton}
                  key={preset.selection}
                  onClick={() => setSelection(preset.selection)}
                  type="button"
                >
                  <span aria-hidden="true">♢</span>
                  <strong>
                    {formatWaterAmount(
                      waterPresetMicroliters[preset.selection],
                      displayUnits,
                      // Stryker disable next-line ConditionalExpression: US preset conversions are exact whole fluid ounces, so zero and one maximum fraction digit render identically.
                      displayUnits === "metric" ? 0 : 1,
                    )}
                  </strong>
                  <span>{unit}</span>
                  <small>{preset.label}</small>
                </button>
              ))}
              <button
                aria-pressed={selection === "exact"}
                className={styles.waterPresetButton}
                onClick={() => setSelection("exact")}
                type="button"
              >
                <span aria-hidden="true">✎</span>
                <strong>Exact</strong>
                <span>amount</span>
                <small>Custom</small>
              </button>
            </div>
            {selection === "exact" ? (
              <label className={styles.waterAmountField}>
                <span>Amount</span>
                <span>
                  <input
                    aria-label={`Amount ${unit}`}
                    inputMode="decimal"
                    max={displayUnits === "metric" ? "15000" : "500"}
                    min="0.001"
                    name="waterAmount"
                    onChange={(changeEvent) => setAmount(changeEvent.target.value)}
                    required
                    step="0.001"
                    type="number"
                    value={amount}
                  />
                  <em>{unit}</em>
                </span>
              </label>
            ) : null}
            {event ? (
              <label className={styles.waterTimeField}>
                <span>Event time</span>
                <input
                  defaultValue={event.localEventTime.slice(0, 5)}
                  name="waterEventTime"
                  required
                  type="time"
                />
              </label>
            ) : null}
            {actionData?.message ? (
              <p className={styles.catalogError} role="alert">
                {actionData.message}
              </p>
            ) : null}
            <div className={styles.waterActions}>
              {event ? (
                <button
                  className={styles.dangerButton}
                  onClick={() => setConfirmingDelete(true)}
                  type="button"
                >
                  Delete Water Event
                </button>
              ) : (
                <span />
              )}
              <div>
                <Link className={styles.secondaryButton} to={closeHref}>
                  Cancel
                </Link>
                <button
                  className={styles.waterSubmitButton}
                  name="intent"
                  type="submit"
                  value={event ? "update-water" : "create-water"}
                >
                  {pendingIntent === "create-water"
                    ? "Adding…"
                    : pendingIntent === "update-water"
                      ? "Saving…"
                      : event
                        ? "Save changes"
                        : selection === "exact"
                          ? "Add exact amount"
                          : `Add ${formatWaterAmount(
                              waterPresetMicroliters[selection],
                              displayUnits,
                              // Stryker disable next-line ConditionalExpression: US preset conversions are exact whole fluid ounces, so zero and one maximum fraction digit render identically.
                              displayUnits === "metric" ? 0 : 1,
                            )} ${unit}`}
                </button>
              </div>
            </div>
            {event && confirmingDelete ? (
              <div className={styles.deleteConfirm} role="alert">
                <div>
                  <strong>Delete this Water Event?</strong>
                  <p>The daily water total will decrease by this amount.</p>
                </div>
                <button
                  className={styles.secondaryButton}
                  onClick={() => setConfirmingDelete(false)}
                  type="button"
                >
                  Keep it
                </button>
                <button
                  className={styles.dangerSubmitButton}
                  formNoValidate
                  name="intent"
                  type="submit"
                  value="delete-water"
                >
                  {pendingIntent === "delete-water" ? "Deleting…" : "Delete"}
                </button>
              </div>
            ) : null}
          </fieldset>
        </Form>
      </section>
    </DialogBackdrop>
  );
}

function CatalogChoiceStage({ date, photoCapture }: { date: string; photoCapture: ReactNode }) {
  return (
    <>
    <div className={styles.catalogResults} aria-label="Add Food methods">
      {photoCapture}
      <Link to={catalogHref(date, "search")}>
        <span>
          <strong>Search for food</strong>
          <small>Search United States foods with USDA FoodData Central.</small>
        </span>
        <small>Choose ›</small>
      </Link>
      <Link to={catalogHref(date, "barcode")}>
        <span>
          <strong>Scan barcode</strong>
          <small>Enter a commercial barcode to review Open Food Facts data.</small>
        </span>
        <small>Choose ›</small>
      </Link>
      <Link to={catalogHref(date, "manual")}>
        <span>
          <strong>Manual</strong>
          <small>Enter a serving and its nutrition yourself.</small>
        </span>
        <small>Choose ›</small>
      </Link>
    </div>
    <details className={styles.providerAttribution}>
      <summary>Photo privacy</summary>
      <p>Deleting a photo meal removes its photo and history from this app. It does not delete data retained by your AI provider.</p>
    </details>
    </>
  );
}

function ManualFoodStage({
  actionData,
  catalog,
  csrfToken,
  date,
}: {
  actionData: HomeActionData | undefined;
  catalog: Extract<
    NonNullable<Route.ComponentProps["loaderData"]["catalog"]>,
    { mode: "manual" }
  >;
  csrfToken: string;
  date: string;
}) {
  const navigation = useNavigation();
  const draft = actionData?.manualFoodDraft;
  const [fields, setFields] = useState<FoodEntryFields>(() => ({
    carbohydrateGrams: draft?.carbohydrateGrams ?? "",
    energyKcal: draft?.energyKcal ?? "",
    fatGrams: draft?.fatGrams ?? "",
    fiberGrams: draft?.fiberGrams ?? "",
    name: draft?.name ?? "",
    proteinGrams: draft?.proteinGrams ?? "",
    quantity: draft?.quantity ?? "1",
    selectedMeasurementId: "serving",
    sodiumMilligrams: draft?.sodiumMilligrams ?? "",
    sugarGrams: draft?.sugarGrams ?? "",
  }));
  const pending =
    navigation.formData?.get("intent") === "log-manual-food";

  return (
    <section aria-labelledby="manual-food-title">
      <Link className={styles.backToResults} to={catalogHref(date, "choose")}>
        ‹ Back to methods
      </Link>
      <div className={styles.foodIdentity}>
        <span className={styles.catalogType}>Manual</span>
        <h3 id="manual-food-title">Add food manually</h3>
        <p>Enter the total nutrition for the quantity you ate.</p>
      </div>
      <Form className={styles.editFoodForm} method="post" noValidate>
        <input name="csrfToken" type="hidden" value={csrfToken} />
        <input name="date" type="hidden" value={date} />
        <input
          name="idempotencyKey"
          type="hidden"
          value={draft?.idempotencyKey ?? catalog.idempotencyKey}
        />
        <input name="intent" type="hidden" value="log-manual-food" />
        <fieldset disabled={pending}>
          <label className={styles.stackedField}>
            <span>Food name</span>
            <input
              maxLength={200}
              name="name"
              onChange={(event) =>
                setFields((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              required
              value={fields.name}
            />
          </label>
          <div className={styles.foodDetailGrid}>
            <div className={styles.stackedField}>
              <span>Measurement</span>
              <strong>1 serving</strong>
              <small>Serving values are used without weight conversion.</small>
            </div>
            <label className={styles.stackedField}>
              <span>Quantity</span>
              <input
                inputMode="decimal"
                max="99"
                min="0.000001"
                name="quantity"
                onChange={(event) =>
                  setFields((current) => ({
                    ...current,
                    quantity: event.target.value,
                  }))
                }
                required
                step="0.000001"
                type="number"
                value={fields.quantity}
              />
            </label>
          </div>
          <div className={styles.editNutritionGrid}>
            {FOOD_NUTRIENT_FIELDS.map(([name, label]) => (
              <label className={styles.stackedField} key={name}>
                <span>{label}</span>
                <input
                  inputMode="decimal"
                  max={name === "sodiumMilligrams" ? "9999999" : "999999.999"}
                  min="0"
                  name={name}
                  onChange={(event) =>
                    setFields((current) => ({
                      ...current,
                      [name]: event.target.value,
                    }))
                  }
                  required={name === "energyKcal"}
                  step={name === "sodiumMilligrams" ? "1" : "0.001"}
                  type="number"
                  value={fields[name]}
                />
              </label>
            ))}
          </div>
          <p className={styles.authoritativeNote}>
            Nutrition is the total for this quantity. Changing quantity here
            does not change the values you entered.
          </p>
          {actionData?.message ? (
            <p className={styles.catalogError} role="alert">
              {actionData.message}
            </p>
          ) : null}
          <div className={styles.dialogActions}>
            <Link className={styles.secondaryButton} to={foodLogHref(date)}>
              Cancel
            </Link>
            <button className={styles.primaryButton} type="submit">
              {pending ? "Adding…" : "Add to Food Log"}
            </button>
          </div>
        </fieldset>
      </Form>
    </section>
  );
}

function BarcodeFoodDetail({
  actionData,
  csrfToken,
  date,
  food,
  idempotencyKey,
}: {
  actionData: HomeActionData | undefined;
  csrfToken: string;
  date: string;
  food: CatalogFood;
  idempotencyKey: string;
}) {
  const [quantity, setQuantity] = useState("1");
  const quantityMicrounits = quantityMicrounitsFromDecimal(quantity);
  const multiplier =
    quantityMicrounits === undefined ? 0 : quantityMicrounits / 1_000_000;
  const displayName =
    food.name === "Unnamed product" && food.barcode
      ? `Unnamed product · ${food.barcode}`
      : food.name;

  return (
    <section aria-labelledby="barcode-product-title">
      <Link
        className={styles.backToResults}
        to={catalogHref(date, "barcode")}
      >
        ‹ Back to scanner
      </Link>
      <div className={styles.foodIdentity}>
        <span className={styles.catalogType}>Open Food Facts</span>
        <h3 id="barcode-product-title">{displayName}</h3>
        <p>Barcode {food.barcode}</p>
      </div>
      <div className={styles.snapshotNote}>
        <span aria-hidden="true">◇</span>
        <p>
          <strong>Saved as a Nutrition Snapshot</strong>
          Confirm to keep these serving values and source details locally if
          Open Food Facts later changes or is unavailable.
        </p>
      </div>
      <Form className={styles.logFoodForm} method="post">
        <input name="csrfToken" type="hidden" value={csrfToken} />
        <input name="date" type="hidden" value={date} />
        <input name="idempotencyKey" type="hidden" value={idempotencyKey} />
        <input name="intent" type="hidden" value="log-food" />
        <input name="provider" type="hidden" value={food.provider} />
        <input
          name="providerFoodId"
          type="hidden"
          value={food.providerFoodId}
        />
        <input
          name="selectedMeasurementId"
          type="hidden"
          value={food.measurements[0]?.id ?? ""}
        />
        <div className={styles.foodDetailGrid}>
          <div className={styles.stackedField}>
            <span>Measurement</span>
            <strong>1 serving</strong>
            <small>Serving values are used directly; no weight conversion.</small>
          </div>
          <label className={styles.stackedField}>
            <span>Quantity</span>
            <input
              inputMode="decimal"
              max="99"
              min="0.000001"
              name="quantity"
              onChange={(event) => setQuantity(event.currentTarget.value)}
              required
              step="0.000001"
              type="number"
              value={quantity}
            />
          </label>
        </div>
        <CatalogNutritionPreview
          carbohydrateLabel="Carbohydrates"
          food={food}
          includeAdditional
          multiplier={multiplier}
        />
        {actionData?.message ? (
          <p className={styles.catalogError} role="alert">
            {actionData.message}
          </p>
        ) : null}
        <div className={styles.dialogActions}>
          <Link className={styles.secondaryButton} to={foodLogHref(date)}>
            Cancel
          </Link>
          <button
            className={styles.primaryButton}
            disabled={quantityMicrounits === undefined}
            type="submit"
          >
            Add to Food Log
          </button>
        </div>
      </Form>
      <p className={styles.providerAttribution}>
        Food data from{" "}
        <a
          href="https://world.openfoodfacts.org/"
          rel="noreferrer"
          target="_blank"
        >
          Open Food Facts
        </a>
      </p>
    </section>
  );
}

function BarcodeCatalogStage({
  actionData,
  catalog,
  csrfToken,
  date,
  navigationPending,
  pending,
}: {
  actionData: HomeActionData | undefined;
  catalog: Extract<
    NonNullable<Route.ComponentProps["loaderData"]["catalog"]>,
    { mode: "barcode" }
  >;
  csrfToken: string;
  date: string;
  navigationPending: boolean;
  pending: boolean;
}) {
  const navigate = useNavigate();
  const [barcode, setBarcode] = useState(catalog.barcode);
  const [clientMessage, setClientMessage] = useState<string>();
  const validBarcode = catalogBarcode(barcode);
  // Stryker disable next-line ConditionalExpression,LogicalOperator,StringLiteral: this opaque key only controls scanner remount identity across reviewed barcodes.
  const scannerKey = catalog.barcode || "new-scan";

  if (catalog.food && !catalog.message && !pending) {
    return (
      <BarcodeFoodDetail
        actionData={actionData}
        csrfToken={csrfToken}
        date={date}
        food={catalog.food}
        idempotencyKey={catalog.idempotencyKey}
      />
    );
  }

  return (
    <>
      <div className={styles.dialogActions}>
        <Link className={styles.backToResults} to={catalogHref(date, "search")}>
          Search for food
        </Link>
      </div>
      <Form
        className={styles.searchForm}
        method="get"
        noValidate
        onSubmit={(event) => {
          if (validBarcode === undefined) {
            event.preventDefault();
            setClientMessage(
              "Enter a supported 7, 8, 12, 13, or 14 digit barcode.",
            );
          }
        }}
      >
        <input name="date" type="hidden" value={date} />
        <input name="food" type="hidden" value="barcode" />
        <label htmlFor="food-barcode">Enter barcode</label>
        <div className={styles.searchControl}>
          <input
            aria-describedby={clientMessage ? "barcode-input-error" : undefined}
            aria-invalid={clientMessage ? true : undefined}
            autoComplete="off"
            autoFocus
            id="food-barcode"
            inputMode="numeric"
            maxLength={14}
            name="barcode"
            onChange={(event) => {
              setBarcode(event.currentTarget.value);
              setClientMessage(undefined);
            }}
            pattern="[0-9]*"
            placeholder="034000470693"
            required
            type="text"
            value={barcode}
          />
          <button className={styles.primaryButton} type="submit">
            {catalog.message && validBarcode ? "Retry" : "Look up"}
          </button>
        </div>
      </Form>
      <BarcodeCameraScanner
        key={scannerKey}
        onDetected={
          // Stryker disable BlockStatement,CallExpression: the mobile browser scan journey asserts the controlled input update, error reset, destination, and one lookup.
          (detectedBarcode) => {
            setBarcode(detectedBarcode);
            setClientMessage(undefined);
            void navigate(barcodeCatalogHref(date, detectedBarcode));
          }
          // Stryker restore BlockStatement,CallExpression
        }
        stopRequested={navigationPending}
      />
      {pending ? (
        <div className={styles.catalogState} role="status">
          <h3>Checking Open Food Facts</h3>
          <p>Reviewing the entered barcode without changing your Food Log.</p>
        </div>
      ) : clientMessage ? (
        <div className={styles.catalogState} id="barcode-input-error" role="alert">
          <h3>Barcode not valid</h3>
          <p>{clientMessage}</p>
        </div>
      ) : catalog.message ? (
        <div className={styles.catalogState} role="alert">
          <h3>{catalog.title}</h3>
          <p>{catalog.message}</p>
        </div>
      ) : (
        <div className={styles.catalogState}>
          <h3>Scan barcode</h3>
          <p>Type the digits printed below a commercial barcode to review it.</p>
        </div>
      )}
    </>
  );
}

function CatalogDialog({
  photoCapture,
  actionData,
  catalog,
  csrfToken,
  date,
}: {
  actionData: HomeActionData | undefined;
  photoCapture: ReactNode;
  catalog: NonNullable<Route.ComponentProps["loaderData"]["catalog"]>;
  csrfToken: string;
  date: string;
}) {
  const navigation = useNavigation();
  const [clientSearchMessage, setClientSearchMessage] = useState<string>();
  const [searchQuery, setSearchQuery] = useState(catalog.query);
  const pendingFoodStage = catalogRouteState(
    new URLSearchParams(navigation.location?.search).get("food"),
  );
  const detailPending =
    catalog.mode === "search" &&
    pendingFoodStage?.mode === "detail";
  const searchPending =
    navigation.state !== "idle" &&
    !detailPending;
  const barcodePending = pendingFoodStage?.mode === "barcode";
  // Stryker disable next-line ConditionalExpression: the blocked-navigation browser journey proves the pending-state teardown and restart guard.
  const navigationPending = navigation.state !== "idle";
  const closeHref = foodLogHref(date);
  const initialFocusSelector =
    catalog.mode === "manual"
      ? 'input[name="name"]:not([disabled])'
      : 'input:not([type="hidden"]):not([disabled]), button:not([disabled]), select:not([disabled]), a[href]';
  const { closeDialog, dialogRef, handleDialogKeyDown } = useModalDialog({
    closeHref,
    initialFocusSelector,
    restoreFocusSelector: "[data-food-dialog-trigger]",
  });

  return (
    <DialogBackdrop onClose={closeDialog}>
      <section
        aria-labelledby="food-dialog-title"
        aria-modal="true"
        className={styles.foodDialog}
        onKeyDown={handleDialogKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <div className={styles.dialogHead}>
          <div>
            <h2 id="food-dialog-title">Add Food</h2>
            <span className={styles.dialogChip}>
              {catalog.mode === "search" || catalog.mode === "detail"
                ? "USDA catalog"
                : catalog.mode === "barcode"
                  ? "Open Food Facts"
                  : catalog.mode === "manual"
                    ? "Manual"
                  : "Choose a method"}
            </span>
            <p>
              {catalog.mode === "choose"
                ? "Choose how to add food. Photo estimates save automatically; other methods let you review first."
                : "Nothing changes in your Food Log until a later confirmation step."}
            </p>
          </div>
          <Link
            aria-label="Close food search"
            className={styles.dialogClose}
            to={closeHref}
          >
            ×
          </Link>
        </div>
        {detailPending ? (
          <FoodDetailSkeleton />
        ) : catalog.mode === "detail" ? (
          <FoodDetailStage
            actionData={actionData}
            catalog={catalog}
            csrfToken={csrfToken}
            date={date}
          />
        ) : catalog.mode === "choose" ? (
          <CatalogChoiceStage date={date} photoCapture={photoCapture} />
        ) : catalog.mode === "manual" ? (
          <ManualFoodStage
            actionData={actionData}
            catalog={catalog}
            csrfToken={csrfToken}
            date={date}
          />
        ) : catalog.mode === "barcode" ? (
          <BarcodeCatalogStage
            actionData={actionData}
            catalog={catalog}
            csrfToken={csrfToken}
            date={date}
            navigationPending={navigationPending}
            pending={barcodePending}
          />
        ) : (
          <>
            <Form
              className={styles.searchForm}
              method="get"
              noValidate
              onSubmit={(event) => {
                if (catalogQuery(searchQuery) === undefined) {
                  event.preventDefault();
                  setClientSearchMessage(
                    "Enter a trimmed food search from 2 to 100 characters.",
                  );
                  return;
                }
              }}
            >
              <input name="date" type="hidden" value={date} />
              <input name="food" type="hidden" value="search" />
              <label htmlFor="food-query">Search United States foods</label>
              <div className={styles.searchControl}>
                <input
                  autoComplete="off"
                  autoFocus
                  aria-describedby={
                    clientSearchMessage ? "food-search-error" : undefined
                  }
                  aria-invalid={clientSearchMessage ? true : undefined}
                  id="food-query"
                  maxLength={100}
                  minLength={2}
                  name="query"
                  onChange={(event) => {
                    setSearchQuery(event.currentTarget.value);
                    setClientSearchMessage(undefined);
                  }}
                  placeholder="Try Greek yogurt"
                  required
                  type="search"
                  value={searchQuery}
                />
                <button className={styles.primaryButton} type="submit">
                  Search
                </button>
              </div>
            </Form>
            {searchPending ? (
              <div className={styles.catalogState} role="status">
                <h3>Searching USDA FoodData Central</h3>
                <p>Your deliberate catalog request is in progress.</p>
              </div>
            ) : clientSearchMessage ? (
              <div
                className={styles.catalogState}
                id="food-search-error"
                role="alert"
              >
                <h3>Search not sent</h3>
                <p>{clientSearchMessage}</p>
              </div>
            ) : (
              <>
                {catalog.message ? (
                  <div className={styles.catalogState} role="alert">
                    <h3>{catalog.title ?? "Search unavailable"}</h3>
                    <p>{catalog.message}</p>
                  </div>
                ) : null}
                {catalog.results.length ? (
                  <div
                    className={styles.catalogResults}
                    aria-label="USDA search results"
                  >
                    {catalog.results.map((result) => {
                      const identity = (
                        <span>
                          <span className={styles.catalogType}>
                            {result.dataType}
                          </span>
                          <strong>{result.name}</strong>
                          <small>
                            {[result.brand, result.measurementSummary]
                              .filter(Boolean)
                              .join(" · ")}
                          </small>
                        </span>
                      );
                      return result.isSelectable ? (
                        <Link
                          key={result.providerFoodId}
                          to={catalogHref(
                            date,
                            result.providerFoodId,
                            catalog.query,
                          )}
                        >
                          {identity}
                          <small>Select ›</small>
                        </Link>
                      ) : (
                        <div aria-disabled="true" key={result.providerFoodId}>
                          {identity}
                          <small>Hidden in production</small>
                        </div>
                      );
                    })}
                  </div>
                ) : catalog.message ? null : catalog.query ? (
                  <div className={styles.catalogState} role="status">
                    <h3>No foods found</h3>
                    <p>
                      Try a broader product or ingredient name. Your Food Log
                      was not changed.
                    </p>
                  </div>
                ) : (
                  <div className={styles.catalogState}>
                    <h3>Find a food</h3>
                    <p>
                      Results can include Branded, Survey/FNDDS, and Foundation
                      foods.
                    </p>
                  </div>
                )}
              </>
            )}
            <p className={styles.providerAttribution}>
              Food data from{" "}
              <a
                href="https://fdc.nal.usda.gov/"
                rel="noreferrer"
                target="_blank"
              >
                USDA FoodData Central
              </a>
            </p>
          </>
        )}
      </section>
    </DialogBackdrop>
  );
}

function PendingFoodEntry({ name }: { name: string }) {
  return (
    <article>
      <div
        aria-label="Adding food to Daily log"
        aria-live="polite"
        className={`${styles.foodEntryCard} ${styles.pendingFoodEntryCard}`}
        role="status"
      >
        <span className={styles.pendingTime} />
        <span className={styles.pendingEntryMarker} aria-hidden="true" />
        <span className={styles.pendingEntryContent}>
          <strong>{name}</strong>
          <span className={styles.pendingEntryLine} />
          <span className={styles.pendingEntryLineShort} />
        </span>
        <span className={styles.pendingEntryEnergy} />
      </div>
    </article>
  );
}

function FoodEntryCopyMenu({
  csrfToken,
  entry,
  idempotencyKey,
}: {
  csrfToken: string;
  entry: Extract<
    Route.ComponentProps["loaderData"]["foodLog"]["events"][number],
    { kind: "food" }
  >;
  idempotencyKey: string;
}) {
  const navigation = useNavigation();
  const [open, setOpen] = useState(false);
  const pending =
    navigation.formData?.get("intent") === "copy-food-to-today" &&
    navigation.formData.get("entryId") === String(entry.id);

  return (
    <div className={styles.foodEntryMenu}>
      <button
        aria-expanded={open}
        aria-label={`More actions for ${entry.name}`}
        className={styles.foodEntryMenuTrigger}
        data-copy-date-trigger={entry.id}
        onClick={() => setOpen((current) => !current)}
        type="button"
      >
        <span aria-hidden="true">•••</span>
      </button>
      {open ? (
        <div className={styles.foodEntryMenuPopover}>
          <Form method="post">
            <input name="csrfToken" type="hidden" value={csrfToken} />
            <input name="date" type="hidden" value={entry.foodLogDate} />
            <input name="entryId" type="hidden" value={entry.id} />
            <input
              name="idempotencyKey"
              type="hidden"
              value={idempotencyKey}
            />
            <button
              disabled={pending}
              name="intent"
              type="submit"
              value="copy-food-to-today"
            >
              {pending ? "Copying…" : "Copy to today"}
            </button>
          </Form>
          <Link
            to={copyFoodEntryHref(entry.foodLogDate, entry.id)}
          >
            Copy to another date…
          </Link>
        </div>
      ) : null}
    </div>
  );
}

type CopyDialogData = NonNullable<
  Route.ComponentProps["loaderData"]["copyDialog"]
>;

function CopyFoodEntryDialog({
  actionData,
  csrfToken,
  dialog,
}: {
  actionData: HomeActionData | undefined;
  csrfToken: string;
  dialog: CopyDialogData;
}) {
  const navigation = useNavigation();
  const closeHref = foodLogHref(dialog.entry.foodLogDate);
  const { closeDialog, dialogRef, handleDialogKeyDown } = useModalDialog({
    closeHref,
    initialFocusSelector: "[data-copy-calendar-day]",
    restoreFocusSelector: `[data-copy-date-trigger="${dialog.entry.id}"]`,
  });
  const pending =
    navigation.formData?.get("intent") === "copy-food-to-date" &&
    navigation.formData.get("entryId") === String(dialog.entry.id);

  const calendarHref = (month: string) =>
    copyFoodEntryHref(dialog.entry.foodLogDate, dialog.entry.id, {
      destinationDate: dialog.destinationDate,
      month,
    });

  return (
    <DialogBackdrop onClose={closeDialog}>
      <section
        aria-labelledby="copy-food-entry-title"
        aria-modal="true"
        className={`${styles.foodDialog} ${styles.copyFoodDialog}`}
        onKeyDown={handleDialogKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <div className={styles.dialogHead}>
          <div>
            <h2 id="copy-food-entry-title">Copy {dialog.entry.name}</h2>
            <p>Choose a destination and review it before creating the copy.</p>
          </div>
          <Link
            aria-label="Close copy dialog"
            className={styles.dialogClose}
            to={closeHref}
          >
            ×
          </Link>
        </div>
        <div className={styles.copyCalendar}>
          <div className={styles.calendarHead}>
            <Link
              aria-label="Previous month"
              className={styles.calendarNav}
              to={calendarHref(dialog.calendar.previousMonth)}
            >
              ‹
            </Link>
            <strong>{dialog.calendar.label}</strong>
            {dialog.calendar.nextMonth ? (
              <Link
                aria-label="Next month"
                className={styles.calendarNav}
                to={calendarHref(dialog.calendar.nextMonth)}
              >
                ›
              </Link>
            ) : (
              <button
                aria-label="Next month"
                className={styles.calendarNavDisabled}
                disabled
                type="button"
              >
                ›
              </button>
            )}
          </div>
          <div
            aria-label={`${dialog.calendar.label} destination calendar`}
            className={styles.calendarGrid}
          >
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
              (day) => (
                <span className={styles.weekday} key={day}>
                  {day}
                </span>
              ),
            )}
            {Array.from(
              { length: dialog.calendar.leadingEmptyDays },
              (_, index) => (
                <span aria-hidden="true" key={`copy-empty-${index}`} />
              ),
            )}
            {dialog.calendar.days.map((day) => {
              const label = formatLocalDate(day.date, {
                day: "numeric",
                month: "long",
                weekday: "long",
              });
              const disabled = day.isFuture || day.isSource;
              const className = [
                disabled ? styles.calendarFuture : styles.calendarDay,
                day.isToday ? styles.calendarToday : "",
                day.isSelected ? styles.calendarSelected : "",
              ]
                .filter(Boolean)
                .join(" ");
              return disabled ? (
                <button
                  aria-label={label}
                  className={className}
                  disabled
                  key={day.date}
                  type="button"
                >
                  {day.day}
                </button>
              ) : (
                <Link
                  aria-current={day.isSelected ? "date" : undefined}
                  aria-label={label}
                  className={className}
                  data-copy-calendar-day
                  key={day.date}
                  to={copyFoodEntryHref(
                    dialog.entry.foodLogDate,
                    dialog.entry.id,
                    {
                      destinationDate: day.date,
                      month: dialog.calendar.month,
                    },
                  )}
                >
                  {day.day}
                </Link>
              );
            })}
          </div>
        </div>
        <div className={styles.copyDestination} aria-live="polite">
          <span>Destination</span>
          <strong>
            {dialog.destinationDate
              ? fullDate(dialog.destinationDate)
              : "Choose an eligible date"}
          </strong>
        </div>
        {actionData?.tone === "error" ? (
          <p className={styles.catalogError} role="alert">
            {actionData.message}
          </p>
        ) : null}
        <Form className={styles.copyActions} method="post">
          <input name="csrfToken" type="hidden" value={csrfToken} />
          <input
            name="date"
            type="hidden"
            value={dialog.entry.foodLogDate}
          />
          <input name="entryId" type="hidden" value={dialog.entry.id} />
          <input
            name="destinationDate"
            type="hidden"
            value={dialog.destinationDate ?? ""}
          />
          <input
            name="idempotencyKey"
            type="hidden"
            value={dialog.idempotencyKey}
          />
          <Link
            className={styles.secondaryButton}
            to={closeHref}
          >
            Cancel
          </Link>
          <button
            className={styles.primaryButton}
            disabled={!dialog.destinationDate || pending}
            name="intent"
            type="submit"
            value="copy-food-to-date"
          >
            {pending ? "Copying…" : "Copy"}
          </button>
        </Form>
      </section>
    </DialogBackdrop>
  );
}

function DateRail({
  nearbyDates,
  selectedDate,
  today,
}: {
  nearbyDates: Route.ComponentProps["loaderData"]["nearbyDates"];
  selectedDate: string;
  today: string;
}) {
  const navigate = useNavigate();
  const swipe = useRef<{
    pointerId: number;
    x: number;
    y: number;
  } | null>(null);
  const swiped = useRef(false);

  function startSwipe(event: ReactPointerEvent<HTMLDivElement>) {
    swiped.current = false;
    if (event.pointerType !== "touch" || !event.isPrimary) {
      swipe.current = null;
      return;
    }
    swipe.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
  }

  function moveSwipe(event: ReactPointerEvent<HTMLDivElement>) {
    const start = swipe.current;
    if (!start || start.pointerId !== event.pointerId) return;
    const dx = Math.abs(event.clientX - start.x);
    const dy = Math.abs(event.clientY - start.y);
    if (dx < 8 && dy < 8) return;
    if (!swiped.current && dy >= dx) {
      swipe.current = null;
      return;
    }
    swiped.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function endSwipe(event: ReactPointerEvent<HTMLDivElement>) {
    const start = swipe.current;
    swipe.current = null;
    if (!start || start.pointerId !== event.pointerId) return;
    const dx = event.clientX - start.x;
    if (
      Math.abs(dx) < 40 ||
      Math.abs(dx) <= Math.abs(event.clientY - start.y)
    ) return;
    swiped.current = true;
    const nextDate = addLocalDays(selectedDate, dx < 0 ? 1 : -1);
    if (nextDate <= today) {
      void navigate(foodLogHref(nextDate), { preventScrollReset: true });
    }
  }

  return (
    <div className={styles.dateRailWrap}>
      <Link
        aria-label="Browse past dates"
        className={styles.dateArrow}
        to={foodLogHref(addLocalDays(selectedDate, -7))}
      >
        ‹
      </Link>
      <div
        className={styles.dateRail}
        aria-label="Nearby dates"
        onClickCapture={(event) => {
          if (swiped.current && event.detail !== 0) event.preventDefault();
        }}
        onPointerDown={startSwipe}
        onPointerMove={moveSwipe}
        onPointerUp={endSwipe}
        onPointerCancel={() => { swipe.current = null; }}
      >
        {nearbyDates.map((day) => {
          const weekday = formatLocalDate(day.date, {
            weekday: "short",
          });
          const dateNumber = formatLocalDate(day.date, {
            day: "numeric",
          });
          return day.isFuture ? (
            <button
              className={styles.futureDate}
              disabled
              key={day.date}
              type="button"
            >
              <small>{weekday}</small>
              <strong>{dateNumber}</strong>
            </button>
          ) : (
            <Link
              aria-current={day.isSelected ? "date" : undefined}
              className={`${styles.dateButton} ${day.isSelected ? styles.selectedDate : ""}`}
              key={day.date}
              to={foodLogHref(day.date)}
            >
              <small>{weekday}</small>
              <strong>{dateNumber}</strong>
            </Link>
          );
        })}
      </div>
      <Link
        aria-label="Open calendar"
        className={styles.dateArrow}
        to={foodLogHref(
          selectedDate,
          selectedDate.slice(0, 7),
        )}
      >
        ›
      </Link>
    </div>
  );
}

export default function Home({ actionData, loaderData }: Route.ComponentProps) {
  const {
    calendar,
    catalog,
    copyDialog,
    copyError,
    copyIdempotencyKeys,
    csrfToken,
    foodEntryEditor,
    foodLog,
    photoMeals = [],
    nearbyDates,
    notice,
    username,
    waterDialog,
  } = loaderData;
  const photoUpload = usePhotoUpload(foodLog.selectedDate, csrfToken);
  const activeFoodEntryEditor =
    actionData?.foodEntryEditor ?? foodEntryEditor;
  const selectedLabel = fullDate(foodLog.selectedDate);
  const activeWaterDialog = actionData?.waterEventEditor
    ? { event: actionData.waterEventEditor, mode: "edit" as const }
    : waterDialog;
  const navigation = useNavigation();
  const foodLogPending = navigation.formData?.get("intent") === "log-food";
  const pendingFoodName =
    catalog?.mode === "detail"
      ? catalog.food.name
      : catalog?.mode === "barcode" && catalog.food
        ? catalog.food.name
        : "Selected food";
  const visibleCatalog = foodLogPending ? undefined : catalog;

  return (
    <>
      <div
        className={styles.shell}
        inert={
          visibleCatalog || activeFoodEntryEditor || activeWaterDialog || copyDialog
            ? true
            : undefined
        }
      >
        <a className={styles.skipLink} href="#food-log-content">
          Skip to daily log
        </a>
        <AppNavigation
          active={calendar ? "history" : "log"}
          csrfToken={csrfToken}
          selectedDate={foodLog.selectedDate}
          today={foodLog.today}
          username={username}
        />
        <main className={styles.appSurface} id="food-log-content">
          <header className={styles.mobileHeader}>
            <div className={styles.titleLine}>
              <h1
                aria-label={
                  calendar
                    ? "Food Log history"
                    : foodLog.selectedDate === foodLog.today
                      ? "Today's Food Log"
                      : `Food Log for ${selectedLabel}`
                }
              >
                {calendar
                  ? "History"
                  : foodLog.selectedDate === foodLog.today
                    ? "Today"
                    : "Food Log"}
              </h1>
              <span className={styles.privacyCue}>◈ Private</span>
            </div>
            <p className={styles.selectedDateLabel}>{selectedLabel}</p>
          </header>

          {calendar ? (
            <CalendarView
              calendar={calendar}
              selectedDate={foodLog.selectedDate}
            />
          ) : (
            <section aria-label="Food Log">
              <DateRail
                nearbyDates={nearbyDates}
                selectedDate={foodLog.selectedDate}
                today={foodLog.today}
              />

              <DailySummary foodLog={foodLog} />

              <section
                className={styles.timelineSection}
                aria-labelledby="daily-log-heading"
              >
                <div className={styles.sectionHeading}>
                  <h2 id="daily-log-heading">Daily log</h2>
                  <span>{selectedLabel}</span>
                </div>
                {notice ? (
                  <p className={styles.actionMessage} role="status">
                    {notice}
                  </p>
                ) : null}
                {copyError ? (
                  <p className={styles.catalogError} role="alert">
                    {copyError}
                  </p>
                ) : null}
                {!foodLog.isFuture ? (
                  <section aria-label="Photo meals">
                    {photoUpload.feedback}
                    <PhotoMeals meals={photoMeals} csrfToken={csrfToken} />
                  </section>
                ) : null}
                {foodLog.isFuture ? (
                  <div className={styles.futureDay}>
                    <span className={styles.emptyIcon} aria-hidden="true">
                      □
                    </span>
                    <h2>Future day</h2>
                    <p>
                      You can review goals, but food and water can only be
                      recorded today or in the past.
                    </p>
                  </div>
                ) : foodLog.events.length || foodLogPending || photoUpload.pending || photoMeals.length ? (
                  <div className={styles.timeline}>
                    <EmptyActionForm
                      className={styles.timelineAddFood}
                      csrfToken={csrfToken}
                      date={foodLog.selectedDate}
                      intent="add-food"
                      label="Add Food"
                      timelineMarker="food"
                    />
                    {foodLogPending ? (
                      <PendingFoodEntry name={pendingFoodName} />
                    ) : null}
                    {foodLog.events.filter((entry) => entry.kind !== "food" || !photoMeals.some((meal) => meal.entryId === entry.id)).map((entry) =>
                      entry.kind === "food" ? (
                        // Stryker disable next-line StringLiteral: a single-prefix mutation preserves key uniqueness against the water prefix.
                        <article key={`food-${entry.id}`}>
                          <Link
                            className={
                              copyIdempotencyKeys[entry.id]
                                ? `${styles.foodEntryCard} ${styles.foodEntryCardWithMenu}`
                                : styles.foodEntryCard
                            }
                            data-entry-editor-trigger
                            to={`${foodLogHref(entry.foodLogDate)}&entry=${entry.id}`}
                          >
                            <time
                              dateTime={`${entry.foodLogDate}T${entry.localEventTime}`}
                            >
                              {formatEventTime(entry.localEventTime)}
                            </time>
                            <span
                              className={styles.foodEntryMarker}
                              aria-hidden="true"
                            >
                              <UiIcon name="utensils" />
                            </span>
                            <span className={styles.foodEntryContent}>
                              <strong>{entry.name}</strong>
                              <small>
                                {entry.provider === "open-food-facts"
                                  ? "Open Food Facts"
                                  : entry.provider === "manual"
                                    ? "Manual"
                                  : entry.provider === "ai-photo" ? "AI photo estimate"
                                  : `USDA FoodData Central · ${entry.dataType}`}
                              </small>
                              <small>
                                {entry.selectedMeasurementLabel} ×{" "}
                                {entry.quantityMicrounits / 1_000_000}
                              </small>
                            </span>
                            <span className={styles.foodEntryEnergy}>
                              {formatEnergy(entry.energyMilliKcal)}{" "}
                              <small>kcal</small>
                            </span>
                          </Link>
                          {copyIdempotencyKeys[entry.id] ? (
                            <FoodEntryCopyMenu
                              csrfToken={csrfToken}
                              entry={entry}
                              idempotencyKey={copyIdempotencyKeys[entry.id]}
                              key={copyIdempotencyKeys[entry.id]}
                            />
                          ) : null}
                        </article>
                      ) : (
                        // Stryker disable next-line StringLiteral: a single-prefix mutation preserves key uniqueness against the food prefix.
                        <article key={`water-${entry.id}`}>
                          <Link
                            className={`${styles.foodEntryCard} ${styles.waterEventCard}`}
                            data-water-editor-trigger
                            to={`${foodLogHref(entry.foodLogDate)}&water=${entry.id}`}
                          >
                            <time
                              dateTime={`${entry.foodLogDate}T${entry.localEventTime}`}
                            >
                              {formatEventTime(entry.localEventTime)}
                            </time>
                            <span
                              className={styles.waterEntryMarker}
                              aria-hidden="true"
                            >
                              <UiIcon name="water" />
                            </span>
                            <span className={styles.foodEntryContent}>
                              <strong>Water</strong>
                              <small>Plain water</small>
                            </span>
                            <span className={styles.foodEntryEnergy}>
                              {formatWaterAmount(
                                entry.amountMicroliters,
                                foodLog.displayUnits,
                              )}{" "}
                              <small>
                                {foodLog.displayUnits === "metric"
                                  ? "ml"
                                  : "fl oz"}
                              </small>
                            </span>
                          </Link>
                        </article>
                      ),
                    )}
                    <EmptyActionForm
                      className={styles.timelineAddWater}
                      csrfToken={csrfToken}
                      date={foodLog.selectedDate}
                      intent="add-water"
                      label="Add Water"
                      timelineMarker="water"
                    />
                    {actionData?.message ? (
                      <p className={styles.actionMessage} role="status">
                        {actionData.message}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div className={styles.emptyDay}>
                    <span className={styles.emptyIcon} aria-hidden="true">
                      □
                    </span>
                    <h3>No entries for this day</h3>
                    <p>
                      {foodLog.selectedDate === foodLog.today
                        ? "Start today’s Food Log with food or water when you’re ready."
                        : "Past-day entries start at 12:00 PM. Add food or water when you’re ready."}
                    </p>
                    <div className={styles.emptyActions}>
                      <EmptyActionForm
                        className={styles.primaryButton}
                        csrfToken={csrfToken}
                        date={foodLog.selectedDate}
                        intent="add-food"
                        label="Add Food"
                      />
                      <EmptyActionForm
                        className={styles.secondaryButton}
                        csrfToken={csrfToken}
                        date={foodLog.selectedDate}
                        intent="add-water"
                        label="Add Water"
                      />
                    </div>
                    {actionData?.message ? (
                      <p className={styles.actionMessage} role="status">
                        {actionData.message}
                      </p>
                    ) : null}
                  </div>
                )}
              </section>
              <p className={styles.dateNote}>
                Food Log date {foodLog.selectedDate} · Time zone{" "}
                {foodLog.timeZone}
              </p>
            </section>
          )}
        </main>
        <DesktopDayContext
          foodLog={foodLog}
          isObscured={Boolean(
            visibleCatalog || activeFoodEntryEditor || activeWaterDialog || copyDialog,
          )}
        />
      </div>
      {visibleCatalog ? (
        <CatalogDialog
          photoCapture={photoUpload.capture}
          actionData={actionData}
          catalog={visibleCatalog}
          csrfToken={csrfToken}
          date={foodLog.selectedDate}
        />
      ) : null}
      {activeFoodEntryEditor ? (
        <FoodEntryEditorDialog
          actionData={actionData}
          csrfToken={csrfToken}
          entry={activeFoodEntryEditor}
          photoMeal={photoMeals.find((meal) => meal.entryId === activeFoodEntryEditor.id)}
          key={activeFoodEntryEditor.updatedAt}
        />
      ) : null}
      {activeWaterDialog ? (
        // Stryker disable ConditionalExpression,StringLiteral: this key controls React remount identity; its literal value is opaque within either dialog mode.
        <WaterEventDialog
          actionData={actionData}
          csrfToken={csrfToken}
          date={foodLog.selectedDate}
          dialog={activeWaterDialog}
          displayUnits={foodLog.displayUnits}
          key={
            activeWaterDialog.mode === "edit"
              ? activeWaterDialog.event.updatedAt
              : "create"
          }
        />
        // Stryker restore ConditionalExpression,StringLiteral
      ) : null}
      {copyDialog ? (
        <CopyFoodEntryDialog
          actionData={actionData}
          csrfToken={csrfToken}
          dialog={copyDialog}
        />
      ) : null}
    </>
  );
}
