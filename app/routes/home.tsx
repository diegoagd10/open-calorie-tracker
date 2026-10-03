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
  useFetcher,
} from "react-router";

import {
  getSessionForApplicationAccess,
  getApplicationMutationSession,
  readApplicationMutationForm,
} from "../auth/http.server";
import { getPhotoAnalysisReadiness, getPhotoAnalysisService } from "../photo-analysis/runtime.server";
import { presentPhotoAnalysisReadiness } from "./photo-analysis-readiness";
import { PhotoMealCard, PhotoMealStatus, PhotoCorrection, PhotoFailureReason, usePhotoMealPolling, usePhotoUpload } from "./photo-meals";
import { DateRail } from "../date-rail";
import { AppNavigation } from "../app-navigation";
import { isTestEnvironment } from "../runtime.server";
import { UiIcon } from "../ui-icon";
import { useWideLayout } from "./wide-layout";
import methodStyles from "./add-food-method.module.css";
import { BarcodeCameraScanner } from "./barcode-camera-scanner";
import { getAuthenticationService } from "../auth/runtime.server";
import {
  CatalogNotInstalledError,
  CatalogStaleReviewError,
  CatalogFoodNotFoundError,
  CatalogInvalidDataError,
  CatalogNutritionUnavailableError,
  CatalogUnknownProviderError,
  CatalogUnavailableError,
  CatalogUnsafeMeasurementError,
  type CatalogOperationContext,
  type CatalogFood,
  type CatalogNutrientValue,
  type CatalogProviderId,
  type CatalogSearchResult,
} from "../catalog/food-catalog.server";
import { isSupportedCommercialBarcode } from "../catalog/barcode";
import {
  getFoodCatalog,
} from "../catalog/runtime.server";
import {
  buildCalendarMonth,
  formatLocalDate,
  getNearbyLocalDates,
  parseIsoLocalDate,
} from "../food-log/date";
import {
  type DailyCalories,
  FutureFoodLogDateError,
  InvalidFoodLogDateError,
} from "../food-log/food-log.server";
import { getFoodLogService } from "../food-log/runtime.server";
import {
  copyFoodEntryIdempotencyKeySchema,
  createCopyFoodEntryIdempotencyKey,
  FoodEntryUnavailableError,
  InvalidFoodEntryInputError,
  savedFoodIdempotencyKeySchema,
  StaleFoodEntryError,
} from "../food-entry/food-entry.server";
import { getFoodEntryService } from "../food-entry/runtime.server";
import {
  quantityMicrounitsFromDecimal,
  scaleCatalogNutrient,
} from "../food-entry/nutrition";
import {
  getWaterEventService,
  WaterEventNotFoundError,
} from "../water-event/index.server";
import {
  WaterDialog,
  waterDialogError,
  waterEventLocalDateTime,
  WaterOverview,
  WaterTimelineItem,
} from "../water-event";
import { waterTargetThousandthsFromMicroliters } from "../goals/water-conversion";
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
      idempotencyKey: z.string(),
      intent: z.literal("log-food"),
      catalogGeneration: z.string().optional(),
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
      date: z.string().refine((value) => parseIsoLocalDate(value) !== undefined),
      entryId: z.string().refine((value) => positiveIntegerId(value) !== undefined),
      intent: z.literal("save-manual-food"),
    }),
    z.object({
      date: z.string().refine((value) => parseIsoLocalDate(value) !== undefined),
      idempotencyKey: savedFoodIdempotencyKeySchema,
      intent: z.literal("log-saved-food"),
      savedFoodId: z.string().refine((value) => positiveIntegerId(value) !== undefined),
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
type SavedFood = ReturnType<
  ReturnType<typeof getFoodEntryService>["readSavedFood"]
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

function FoodNameField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return <label className={styles.stackedField}>
    <span>Food name</span>
    <input maxLength={200} name="name" onChange={event => onChange(event.target.value)} required value={value} />
  </label>;
}

function catalogFailure(
  error: unknown,
): { message: string; status: number; title: string } | undefined {
  if (error instanceof CatalogStaleReviewError) return { message: error.message, status: 409, title: "Review food again" };
  if (error instanceof CatalogNutritionUnavailableError) return { message: "This food has no usable calories in the installed catalog.", status: 422, title: "Nutrition unavailable" };
  if (error instanceof CatalogNotInstalledError) {
    return {
      message:
        "USDA Foundation is not installed. Ask your administrator to install it in Food Catalogs Settings. Your saved Food Entries remain available.",
      status: 503,
      title: "USDA Foundation is not installed",
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
  if (error instanceof CatalogInvalidDataError) {
    return {
      message: "The installed USDA catalog contains food data that could not be used safely.",
      status: 500,
      title: "USDA catalog data could not be used",
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
  if (error instanceof CatalogNotInstalledError) {
    return {
      message:
        "An administrator can install Open Food Facts in Settings → Food Catalogs. USDA search and saved Food Entries remain available.",
      status: 503,
      title: "Open Food Facts is not installed",
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
        "This product has no usable nutrition with a supported calculation basis.",
      status: 422,
      title: "Nutrition unavailable",
    };
  }
  if (error instanceof CatalogUnsafeMeasurementError) {
    return {
      message:
        "This product no longer has the selected supported measurement. Your Food Log was not changed.",
      status: 422,
      title: "Measurement unavailable",
    };
  }
  if (error instanceof CatalogInvalidDataError) {
    return {
      message: "The installed Open Food Facts catalog contains product data that could not be used safely.",
      status: 500,
      title: "Open Food Facts catalog data could not be used",
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
    { title: "Open Calorie Tracker · Private application" },
    {
      name: "description",
      content: "Your private Open Calorie Tracker application space",
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
  const photoAnalysisReadiness = presentPhotoAnalysisReadiness(
    await getPhotoAnalysisReadiness(),
    session.user.role,
  );

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
  const summarizedDates = [
    ...nearbyDates.map((day) => day.date),
    ...(calendar?.days.map((day) => day.date) ?? []),
  ].filter((date) => date <= foodLog.today);
  const dailyCalories = foodLogServiceForRequest(request).dailyCalories(
    session.user.id,
    [...new Set(summarizedDates)],
  );

  const requestedEntry = url.searchParams.get("entry");
  let foodEntryEditor;
  let manualEntrySaved = false;
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
      if (foodEntryEditor.provider === "manual") {
        manualEntrySaved = getFoodEntryService(testRequestInstant(request))
          .isManualEntrySaved(session.user.id, entryId);
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
    | {
        error?: string;
        event?: ReturnType<ReturnType<typeof getWaterEventService>["read"]>;
        initialLocalLogDate: string;
      }
    | undefined;
  if (requestedWater !== null && !foodLog.isFuture) {
    const error = waterDialogError(url.searchParams.get("waterError"));
    const initialLocalLogDate = foodLog.selectedDate === foodLog.today
      ? foodLog.localNow
      : `${foodLog.selectedDate}T12:00`;
    if (requestedWater === "new") {
      waterDialog = { error, initialLocalLogDate };
    } else {
      const eventId = positiveIntegerId(requestedWater);
      try {
        const event = getWaterEventService(testRequestInstant(request)).read(
          session.user.id,
          eventId ?? 0,
        );
        if (
          waterEventLocalDateTime(event.logDate, foodLog.timeZone).slice(0, 10) !==
          foodLog.selectedDate
        ) {
          throw new WaterEventNotFoundError();
        }
        waterDialog = { error, event, initialLocalLogDate };
      } catch (error) {
        if (error instanceof WaterEventNotFoundError) {
          throw new Response(error.message, { status: 404 });
        }
        throw error;
      }
    }
  }

  const foodStage = catalogRouteState(
    url.searchParams.get("food"),
    url.searchParams.get("provider"),
  );
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
        results: CatalogSearchResult[];
        savedResults: SavedFood[];
        message?: string;
        title?: string;
      }
    | { mode: "my"; query: string; results: SavedFood[] }
    | { mode: "saved"; query: string; food: SavedFood; idempotencyKey: string }
    | {
        mode: "detail";
        query: string;
        food: CatalogFood;
        idempotencyKey: string;
      }
    | undefined;
  if (foodStage && !foodLog.isFuture) {
    if (foodStage.mode === "choose") {
      catalog = { mode: "choose", query: "" };
    } else if (foodStage.mode === "manual") {
      catalog = { idempotencyKey: randomUUID(), mode: "manual", query: "" };
    } else if (foodStage.mode === "my") {
      const query = requestedQuery.trim();
      catalog = {
        mode: "my",
        query,
        results: getFoodEntryService(testRequestInstant(request))
          .listSavedFoods(session.user.id, query),
      };
    } else if (foodStage.mode === "saved") {
      try {
        catalog = {
          food: getFoodEntryService(testRequestInstant(request))
            .readSavedFood(session.user.id, foodStage.savedFoodId),
          idempotencyKey: randomUUID(),
          mode: "saved",
          query: requestedQuery,
        };
      } catch (error) {
        if (error instanceof FoodEntryUnavailableError) {
          throw new Response(error.message, { status: 404 });
        }
        throw error;
      }
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
        catalog = {
          mode: "search",
          query: "",
          results: [],
          savedResults: getFoodEntryService(testRequestInstant(request))
            .listSavedFoods(session.user.id),
        };
      } else if (parsedQuery === undefined) {
        responseStatus = 400;
        catalog = {
          message: "Enter a food search from 2 to 100 characters.",
          mode: "search",
          query: requestedQuery,
          results: [],
          savedResults: [],
          title: "Search not sent",
        };
      } else {
        try {
          catalog = {
            mode: "search",
            query: parsedQuery,
            results: await getFoodCatalog().search(parsedQuery, catalogContext),
            savedResults: getFoodEntryService(testRequestInstant(request))
              .listSavedFoods(session.user.id, parsedQuery),
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
            savedResults: getFoodEntryService(testRequestInstant(request))
              .listSavedFoods(session.user.id, parsedQuery),
            title: failure.title,
          };
        }
      }
    } else {
      const foodCatalog = getFoodCatalog();
      try {
        catalog = {
          food: await foodCatalog.getFood(foodStage.provider, foodStage.providerFoodId, catalogContext),
          idempotencyKey: randomUUID(),
          mode: "detail",
          query: requestedQuery,
        };
      } catch (error) {
        const failure = foodStage.provider === "open-food-facts"
          ? barcodeCatalogFailure(error)
          : catalogFailure(error);
        if (!failure) throw error;
        responseStatus = failure.status;
        let results: CatalogSearchResult[] = [];
        const parsedQuery = catalogQuery(requestedQuery);
        if (
          error instanceof CatalogFoodNotFoundError &&
          parsedQuery !== undefined
        ) {
          try {
            results = (await foodCatalog.search(parsedQuery, catalogContext))
              .filter(result =>
                result.provider !== foodStage.provider || result.providerFoodId !== foodStage.providerFoodId);
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
          savedResults: getFoodEntryService(testRequestInstant(request))
            .listSavedFoods(session.user.id, requestedQuery),
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
      dailyCalories,
      foodEntryEditor,
      manualEntrySaved,
      photoMeals,
      photoAnalysisReadiness,
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
  if (value === "food-saved") {
    return "Added to My foods.";
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
  | { mode: "detail"; provider: CatalogProviderId; providerFoodId: string }
  | { mode: "manual" }
  | { mode: "my" }
  | { mode: "saved"; savedFoodId: number }
  | { mode: "search" };

function positiveIntegerId(value: string | null): number | undefined {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 && String(id) === value
    ? id
    : undefined;
}

function catalogRouteState(
  value: string | null,
  requestedProvider: string | null,
): CatalogRouteState | undefined {
  if (value === "search") return { mode: "search" };
  if (value === "choose") return { mode: "choose" };
  if (value === "barcode") return { mode: "barcode" };
  if (value === "manual") return { mode: "manual" };
  if (value === "my") return { mode: "my" };
  if (value?.startsWith("saved:")) {
    const savedFoodId = positiveIntegerId(value.slice(6));
    if (savedFoodId !== undefined) return { mode: "saved", savedFoodId };
  }
  const provider = requestedProvider === null || requestedProvider === "usda-fdc"
    ? "usda-fdc"
    : requestedProvider === "open-food-facts"
      ? "open-food-facts"
      : undefined;
  if (!provider || value === null) return undefined;
  if (provider === "usda-fdc") {
    const providerFoodId = positiveIntegerId(value);
    if (providerFoodId !== undefined) return { mode: "detail", provider, providerFoodId: String(providerFoodId) };
  } else if (isSupportedCommercialBarcode(value)) {
    return { mode: "detail", provider, providerFoodId: value };
  }
  return undefined;
}

function formString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function action({ request }: Route.ActionArgs) {
  const session = await getApplicationMutationSession(request);
  if (session instanceof Response) return session;
  const catalogContext = catalogOperationContext(request);

  const formData = await readApplicationMutationForm(request, session);

  const formFields = Object.fromEntries([
    "carbohydrateGrams", "date", "destinationDate", "energyKcal", "entryId", "expectedUpdatedAt", "fatGrams", "fiberGrams", "idempotencyKey", "intent", "name", "proteinGrams", "providerFoodId", "provider", "quantity", "savedFoodId", "selectedMeasurementId", "sodiumMilligrams", "sugarGrams"
  ].map(name => [name, formString(formData, name)]));
  const parsed = foodLogIntentSchema().safeParse({
    ...formFields,
    catalogGeneration: formString(formData, "catalogGeneration") || undefined,
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

  if (parsed.data.intent === "save-manual-food") {
    const entryId = Number(parsed.data.entryId);
    try {
      const service = getFoodEntryService(testRequestInstant(request));
      const entry = service.read(session.user.id, entryId);
      if (entry.foodLogDate !== parsed.data.date) {
        throw new FoodEntryUnavailableError();
      }
      service.saveManualEntry(session.user.id, entryId);
      return redirect(`${foodLogHref(parsed.data.date)}&entry=${entryId}&notice=food-saved`);
    } catch (error) {
      if (error instanceof FoodEntryUnavailableError) {
        return data<HomeActionData>(
          { message: error.message, tone: "error" },
          { status: 404 },
        );
      }
      throw error;
    }
  }

  if (parsed.data.intent === "log-saved-food") {
    const savedFoodId = Number(parsed.data.savedFoodId);
    try {
      getFoodEntryService(testRequestInstant(request)).logSavedFood(
        session.user.id,
        savedFoodId,
        parsed.data.date,
        parsed.data.idempotencyKey,
      );
      return redirect(foodLogHref(parsed.data.date));
    } catch (error) {
      if (error instanceof FoodEntryUnavailableError) {
        return data<HomeActionData>(
          { message: error.message, tone: "error" },
          { status: 404 },
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
        catalogGeneration: parsed.data.catalogGeneration,
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

/** A goal's water target as decimal fluid ounces, the unit Water Events are stored in. */
function waterGoalOunces(waterTargetMicroliters: number): string {
  const thousandths = waterTargetThousandthsFromMicroliters(waterTargetMicroliters, "us");
  const fraction = String(thousandths % 1_000n).padStart(3, "0").replace(/0+$/, "");
  return fraction ? `${thousandths / 1_000n}.${fraction}` : String(thousandths / 1_000n);
}

/** How a day's calories compare with that day's goal, for the week strip and calendar. */
function calorieDaySummary(summary: DailyCalories | undefined) {
  if (!summary || summary.entryCount === 0) return undefined;
  const kcal = Math.round(summary.knownMilliKcal / 1_000).toLocaleString("en-US");
  const goal = summary.goalMilliKcal;
  return {
    label: `${kcal} kcal${summary.isIncomplete ? " known" : ""}`,
    progress: goal ? `${Math.min(100, (summary.knownMilliKcal / goal) * 100).toFixed(1)}%` : undefined,
    // Known calories already past the goal are over; otherwise an incomplete day stays undecided.
    tone:
      goal === null
        ? "logged"
        : summary.knownMilliKcal > goal
          ? "over"
          : summary.isIncomplete
            ? "incomplete"
            : "within",
  } as const;
}

function CalendarView({
  calendar,
  dailyCalories,
  selectedDate,
}: {
  calendar: NonNullable<Route.ComponentProps["loaderData"]["calendar"]>;
  dailyCalories: Record<string, DailyCalories>;
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
            <span aria-hidden="true" key={`empty-${index}`} />
          ))}
          {calendar.days.map((day) => {
            const calories = day.isFuture
              ? undefined
              : calorieDaySummary(dailyCalories[day.date]);
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
                aria-label={calories ? `${label}, ${calories.label}` : label}
                className={className}
                data-calorie-tone={calories?.tone}
                key={day.date}
                to={foodLogHref(day.date)}
              >
                <span>{day.day}</span>
                {calories ? (
                  <span className={styles.calendarCalories} aria-hidden="true">
                    <small>{calories.label}</small>
                    {calories.progress ? (
                      <span style={{ "--progress": calories.progress } as CSSProperties}>
                        <span />
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function QuickLogActionForm({
  className,
  csrfToken,
  date,
  icon,
  intent,
  label,
  visibleLabel,
}: {
  className: string;
  csrfToken: string;
  date: string;
  icon: "plus" | "water";
  intent: "add-food" | "add-water";
  label: string;
  visibleLabel?: string;
}) {
  return (
    <Form method="post">
      <input name="csrfToken" type="hidden" value={csrfToken} />
      <input name="date" type="hidden" value={date} />
      <button
        aria-label={label}
        className={className}
        data-food-dialog-trigger={intent === "add-food" ? true : undefined}
        data-water-dialog-trigger={intent === "add-water" ? true : undefined}
        name="intent"
        title={label}
        type="submit"
        value={intent}
      >
        <UiIcon name={icon} />
        {visibleLabel ? <span>{visibleLabel}</span> : null}
      </button>
    </Form>
  );
}

function QuickLogActions({
  csrfToken,
  date,
  inline = false,
}: {
  csrfToken: string;
  date: string;
  inline?: boolean;
}) {
  return (
    <div
      aria-label={inline ? "Add to this day" : "Quick log"}
      className={inline ? `${styles.quickLogActions} ${styles.emptyDayActions}` : styles.quickLogActions}
      role="group"
    >
      <QuickLogActionForm
        className={`${styles.quickLogButton} ${styles.quickLogFood}`}
        csrfToken={csrfToken}
        date={date}
        icon="plus"
        intent="add-food"
        label="Add Food"
        visibleLabel="Add food"
      />
      <QuickLogActionForm
        className={`${styles.quickLogButton} ${styles.quickLogWater}`}
        csrfToken={csrfToken}
        date={date}
        icon="water"
        intent="add-water"
        label="Add Water"
        visibleLabel={inline ? "Add water" : undefined}
      />
    </div>
  );
}

function catalogHref(date: string, food: string, query?: string, provider?: CatalogProviderId): string {
  const parameters = new URLSearchParams({ date, food });
  if (query) parameters.set("query", query);
  if (provider) parameters.set("provider", provider);
  return `/?${parameters}`;
}

function barcodeCatalogHref(date: string, barcode: string): string {
  const parameters = new URLSearchParams({ barcode, date, food: "barcode" });
  return `/?${parameters}`;
}

function formatEnergy(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(
    value / 1_000,
  );
}

function formatCanonicalNutrient(value: number, unit: "g" | "mg"): string {
  return new Intl.NumberFormat("en-US", {
    maximumFractionDigits: unit === "g" ? 3 : 0,
  }).format(unit === "g" ? value / 1_000 : value);
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
  const wideLayout = useWideLayout();
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
        horizontalDistance < 0
          ? Math.min(page + 1, metricPages.length - 1)
          : Math.max(page - 1, 0),
      );
    }
    setNutrientDragX(0);
    setNutrientSettling(true);
  }

  const goal = foodLog.goal;
  const totals = foodLog.nutritionTotals;
  const calorieTotal = totals.energyMilliKcal;
  const calorieGoal = goal?.calorieTargetMilliKcal;
  const calorieKnown = formatEnergy(calorieTotal.known);
  const calorieGoalDisplay = calorieGoal ? formatEnergy(calorieGoal) : undefined;
  const calorieDescription = calorieGoal
    ? `${calorieKnown}${calorieTotal.isIncomplete ? " known" : ""} of ${calorieGoalDisplay} kcal target${calorieTotal.isIncomplete ? "; incomplete" : ""}`
    : undefined;
  const metricPages: NutritionMetric[][] = [
    [
      {
        goal: goal?.proteinTargetMilligrams ?? null,
        goalKind: "target",
        isIncomplete: totals.proteinMilligrams.isIncomplete,
        key: "protein",
        known: totals.proteinMilligrams.known,
        label: "Protein",
        unit: "g",
      },
      {
        goal: goal?.carbohydrateTargetMilligrams ?? null,
        goalKind: "target",
        isIncomplete: totals.carbohydrateMilligrams.isIncomplete,
        key: "carbohydrate",
        known: totals.carbohydrateMilligrams.known,
        label: "Carbohydrate",
        unit: "g",
      },
      {
        goal: goal?.fatTargetMilligrams ?? null,
        goalKind: "target",
        isIncomplete: totals.fatMilligrams.isIncomplete,
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
        key: "fiber",
        known: totals.fiberMilligrams.known,
        label: "Fiber",
        unit: "g",
      },
      {
        goal: goal?.sugarMaximumMilligrams ?? null,
        goalKind: "maximum",
        isIncomplete: totals.sugarMilligrams.isIncomplete,
        key: "sugar",
        known: totals.sugarMilligrams.known,
        label: "Sugar",
        unit: "g",
      },
      {
        goal: goal?.sodiumMaximumMilligrams ?? null,
        goalKind: "maximum",
        isIncomplete: totals.sodiumMilligrams.isIncomplete,
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
                // Only a measured phone layout hides the off-screen page; desktop and
                // server-rendered markup keep every nutrient exposed.
                aria-hidden={wideLayout === false && nutrientPage !== page}
                className={styles.nutrientPage}
                key={page}
              >
                {metrics.map((metric) => (
                  <NutrientMetric key={metric.key} metric={metric} />
                ))}
              </div>
            ))}
          </div>
          {wideLayout === true ? null : (
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
          )}
        </section>
      </section>

      <WaterOverview
        addHref={`${foodLogHref(foodLog.selectedDate)}&water=new`}
        displayUnits={foodLog.displayUnits}
        goalOunces={goal ? waterGoalOunces(goal.waterTargetMicroliters) : null}
        totalOunces={foodLog.waterTotalOunces}
      />
    </>
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
          {food.provider === "usda-fdc" ? "USDA FoodData Central" : "Open Food Facts"}
          {food.brand ? ` · ${food.brand}` : ""}
        </p>
      </div>
      <div className={styles.snapshotNote}>
        <span aria-hidden="true">◇</span>
        <p>
          <strong>Saved as a Nutrition Snapshot</strong>
          This entry keeps these values and source details if its catalog later
          changes or is unavailable.
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
        {food.catalogGeneration ? <input name="catalogGeneration" type="hidden" value={food.catalogGeneration} /> : null}
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
        <FoodLogFormActions date={date} message={actionData?.message}>
          <button className={styles.primaryButton} type="submit">
            Add to Food Log
          </button>
        </FoodLogFormActions>
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

type FoodNutrientName = (typeof FOOD_NUTRIENT_FIELDS)[number][0];

function FoodNutritionInputs({
  fields,
  onChange,
  required,
}: {
  fields: FoodEntryFields;
  onChange: (name: FoodNutrientName, value: string) => void;
  required: (name: FoodNutrientName) => boolean | undefined;
}) {
  return (
    <div className={styles.editNutritionGrid}>
      {FOOD_NUTRIENT_FIELDS.map(([name, label]) => (
        <label className={styles.stackedField} key={name}>
          <span>{label}</span>
          <input
            inputMode="decimal"
            max={name === "sodiumMilligrams" ? "9999999" : "999999.999"}
            min="0"
            name={name}
            onChange={(event) => onChange(name, event.target.value)}
            required={required(name)}
            step={name === "sodiumMilligrams" ? "1" : "0.001"}
            type="number"
            value={fields[name]}
          />
        </label>
      ))}
    </div>
  );
}

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
    const focusable = [
      ...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), a[href]',
      ) ?? []),
    ].filter((element) => element.offsetParent !== null);
    const first = focusable[0];
    const last = focusable.at(-1);
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
  copyKey,
  csrfToken,
  entry,
  manualEntrySaved,
  photoMeal,
}: {
  actionData: HomeActionData | undefined;
  copyKey?: string;
  csrfToken: string;
  manualEntrySaved: boolean;
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
  const correction = useFetcher({ key: photoMeal ? `photo-correction:${photoMeal.id}` : undefined });
  const navigationPending = navigation.formData?.get("entryId") === String(entry.id);
  const pending = navigationPending || correction.state !== "idle" || photoMeal?.status === "active";
  const pendingIntent = navigationPending
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
        <div className={`${styles.dialogHead} ${styles.editDialogHead}`}>
          <div>
            <h2 id="edit-food-entry-title">Edit Food Entry</h2>
            <span className={styles.dialogChip}>Nutrition Snapshot</span>
            <p>Changes affect this occurrence only.</p>
          </div>
          <div className={styles.editHeaderActions}>
            {copyKey ? (
              <FoodEntryCopyMenu
                csrfToken={csrfToken}
                entry={entry}
                idempotencyKey={copyKey}
                pending={pending}
              />
            ) : null}
            <button
              aria-label="Delete entry"
              className={`${styles.editIconButton} ${styles.editDeleteButton}`}
              disabled={pending}
              onClick={() => setConfirmingDelete(true)}
              title="Delete entry"
              type="button"
            >
              <UiIcon name="delete" />
            </button>
            <Link
              aria-label="Cancel"
              className={styles.editIconButton}
              title="Cancel"
              to={closeHref}
            >
              <UiIcon name="cancel" />
            </Link>
            <button
              aria-label={pendingIntent === "update-food" ? "Saving changes" : "Save changes"}
              className={`${styles.editIconButton} ${styles.editSaveButton}`}
              disabled={pending}
              form="food-entry-edit-form"
              name="intent"
              title={pendingIntent === "update-food" ? "Saving changes" : "Save changes"}
              type="submit"
              value="update-food"
            >
              <UiIcon name="save" />
            </button>
          </div>
        </div>
        {entry.provider === "manual" ? (
          manualEntrySaved ? (
            <p className={styles.authoritativeNote} role="status">
              In My foods. Changes to this daily entry do not change the saved food.
            </p>
          ) : (
            <Form method="post">
              <input name="csrfToken" type="hidden" value={csrfToken} />
              <input name="date" type="hidden" value={entry.foodLogDate} />
              <input name="entryId" type="hidden" value={entry.id} />
              <button className={styles.secondaryButton} name="intent" type="submit" value="save-manual-food">
                Add to My foods
              </button>
            </Form>
          )
        ) : null}
        {confirmingDelete ? (
          <div className={`${styles.deleteConfirm} ${styles.editDeleteConfirm}`} role="alert">
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
              disabled={pending}
              form="food-entry-edit-form"
              formNoValidate
              name="intent"
              type="submit"
              value="delete-food"
            >
              {pendingIntent === "delete-food" ? "Deleting…" : "Delete"}
            </button>
          </div>
        ) : null}
        {photoMeal ? <PhotoCorrection meal={photoMeal} csrfToken={csrfToken} /> : null}
        <Form className={styles.editFoodForm} id="food-entry-edit-form" method="post" noValidate>
          <input name="csrfToken" type="hidden" value={csrfToken} />
          <input name="date" type="hidden" value={entry.foodLogDate} />
          <input name="entryId" type="hidden" value={entry.id} />
          <input
            name="expectedUpdatedAt"
            type="hidden"
            value={entry.updatedAt}
          />
          <fieldset disabled={pending}>
            <FoodNameField value={fields.name} onChange={name => setFields(current => ({ ...current, name }))} />
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
            <FoodNutritionInputs
              fields={fields}
              onChange={(name, value) => setFields((current) => ({ ...current, [name]: value }))}
              required={(name) => entry.provider === "manual" && name === "energyKcal" ? true : undefined}
            />
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
          </fieldset>
        </Form>
      </section>
    </DialogBackdrop>
  );
}

function WaterDialogModal({
  csrfToken,
  date,
  dialog,
}: {
  csrfToken: string;
  date: string;
  dialog: NonNullable<Route.ComponentProps["loaderData"]["waterDialog"]>;
}) {
  const closeHref = foodLogHref(date);
  const { closeDialog, dialogRef, handleDialogKeyDown } = useModalDialog({
    closeHref,
    initialFocusSelector: 'input:not([type="hidden"])',
    restoreFocusSelector:
      "[data-water-editor-trigger], [data-water-dialog-trigger]",
  });
  return (
    <DialogBackdrop onClose={closeDialog}>
      <WaterDialog
        actionHref="/water-events"
        closeHref={closeHref}
        csrfToken={csrfToken}
        dialogRef={dialogRef}
        error={dialog.error}
        event={dialog.event}
        initialLocalLogDate={dialog.initialLocalLogDate}
        onKeyDown={handleDialogKeyDown}
        returnDate={date}
      />
    </DialogBackdrop>
  );
}

function CatalogChoiceStage({ date, photoCapture }: { date: string; photoCapture: ReactNode }) {
  return (
    <>
    <div className={methodStyles.methods} aria-label="Add Food methods">
      <Link className={`${methodStyles.method} ${methodStyles.savedMethod}`} to={catalogHref(date, "my")}>
        <span className={methodStyles.icon}>
          <UiIcon name="utensils" />
        </span>
        <span className={methodStyles.label}>My foods</span>
      </Link>
      {photoCapture}
      <Link aria-label="Search for food" className={methodStyles.method} to={catalogHref(date, "search")}>
        <span className={methodStyles.icon}>
          <UiIcon name="search" />
        </span>
        <span className={methodStyles.label}>Search food</span>
      </Link>
      <Link className={methodStyles.method} to={catalogHref(date, "barcode")}>
        <span className={methodStyles.icon}>
          <UiIcon name="barcode" />
        </span>
        <span className={methodStyles.label}>Scan barcode</span>
      </Link>
      <Link className={methodStyles.method} to={catalogHref(date, "manual")}>
        <span className={methodStyles.icon}>
          <UiIcon name="pencil" />
        </span>
        <span className={methodStyles.label}>Manual</span>
      </Link>
    </div>
    <details className={styles.providerAttribution}>
      <summary>Photo privacy</summary>
      <p>AI estimates calories and saves to your log. You can correct it. Your photo is shared with the AI provider for analysis.</p>
      <p>Deleting a photo meal removes its photo and history from this app. It does not delete data retained by your AI provider.</p>
    </details>
    </>
  );
}

function SavedFoodResults({
  date,
  foods,
  query,
}: {
  date: string;
  foods: SavedFood[];
  query: string;
}) {
  return (
    <div className={styles.catalogResults} aria-label="My foods results">
      {foods.map((food) => (
        <Link key={food.id} to={catalogHref(date, `saved:${food.id}`, query)}>
          <span>
            <strong>{food.name}</strong>
            <small>
              {food.selectedMeasurementLabel} × {food.quantityMicrounits / 1_000_000}
              {" · "}{formatEnergy(food.energyMilliKcal)} kcal
            </small>
          </span>
          <small>Select ›</small>
        </Link>
      ))}
    </div>
  );
}

function MyFoodsStage({
  catalog,
  date,
}: {
  catalog: Extract<NonNullable<Route.ComponentProps["loaderData"]["catalog"]>, { mode: "my" }>;
  date: string;
}) {
  return (
    <section aria-labelledby="my-foods-title">
      <Link className={styles.backToResults} to={catalogHref(date, "choose")}>
        ‹ Back to methods
      </Link>
      <div className={styles.foodIdentity}>
        <span className={styles.catalogType}>Manual foods</span>
        <h3 id="my-foods-title">My foods</h3>
        <p>Reuse a food you entered manually.</p>
      </div>
      <Form className={styles.searchForm} method="get">
        <input name="date" type="hidden" value={date} />
        <input name="food" type="hidden" value="my" />
        <label htmlFor="my-food-query">Search My foods</label>
        <div className={styles.searchControl}>
          <input
            autoComplete="off"
            defaultValue={catalog.query}
            id="my-food-query"
            name="query"
            placeholder="Try Mexican tortilla"
            type="search"
          />
          <button className={styles.primaryButton} type="submit">Search</button>
        </div>
      </Form>
      {catalog.results.length ? (
        <SavedFoodResults date={date} foods={catalog.results} query={catalog.query} />
      ) : (
        <div className={styles.catalogState} role="status">
          <h3>{catalog.query ? "No matching foods" : "No foods saved yet"}</h3>
          <p>New manual foods are saved here automatically. Open an older manual entry to add it here.</p>
        </div>
      )}
    </section>
  );
}

function SavedFoodStage({
  actionData,
  catalog,
  csrfToken,
  date,
}: {
  actionData: HomeActionData | undefined;
  catalog: Extract<NonNullable<Route.ComponentProps["loaderData"]["catalog"]>, { mode: "saved" }>;
  csrfToken: string;
  date: string;
}) {
  const { food } = catalog;
  const navigation = useNavigation();
  const pending = navigation.formData?.get("intent") === "log-saved-food";
  const nutrients = [
    ["Calories (kcal)", storedNutrientInput(food.energyMilliKcal)],
    ["Protein (g)", storedNutrientInput(food.proteinMilligrams)],
    ["Carbohydrate (g)", storedNutrientInput(food.carbohydrateMilligrams)],
    ["Fat (g)", storedNutrientInput(food.fatMilligrams)],
    ["Fiber (g)", storedNutrientInput(food.fiberMilligrams)],
    ["Sugar (g)", storedNutrientInput(food.sugarMilligrams)],
    ["Sodium (mg)", storedNutrientInput(food.sodiumMilligrams, true)],
  ];
  return (
    <section aria-labelledby="saved-food-title">
      <Link className={styles.backToResults} to={catalogHref(date, "my", catalog.query)}>
        ‹ Back to My foods
      </Link>
      <div className={styles.foodIdentity}>
        <span className={styles.catalogType}>My foods</span>
        <h3 id="saved-food-title">{food.name}</h3>
        <p>Review the saved values before adding this food to {fullDate(date)}.</p>
      </div>
      <div className={styles.foodDetailGrid}>
        <div className={styles.stackedField}>
          <span>Measurement</span>
          <strong>{food.selectedMeasurementLabel}</strong>
        </div>
        <div className={styles.stackedField}>
          <span>Quantity</span>
          <strong>{food.quantityMicrounits / 1_000_000}</strong>
        </div>
      </div>
      <dl className={styles.nutritionPreview}>
        {nutrients.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value || "Unknown"}</dd>
          </div>
        ))}
      </dl>
      <Form method="post">
        <input name="csrfToken" type="hidden" value={csrfToken} />
        <input name="date" type="hidden" value={date} />
        <input name="savedFoodId" type="hidden" value={food.id} />
        <input name="idempotencyKey" type="hidden" value={catalog.idempotencyKey} />
        <FoodLogFormActions date={date} message={actionData?.message}>
          <button className={styles.primaryButton} disabled={pending} name="intent" type="submit" value="log-saved-food">
            {pending ? "Adding…" : "Add to Food Log"}
          </button>
        </FoodLogFormActions>
      </Form>
    </section>
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
          <FoodNameField value={fields.name} onChange={name => setFields(current => ({ ...current, name }))} />
          <div className={styles.editNutritionGrid}>
            <div className={styles.stackedField}>
              <span>Measurement</span>
              <strong className={styles.readOnlyMeasurement}>1 serving</strong>
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
          <FoodNutritionInputs
            fields={fields}
            onChange={(name, value) => setFields((current) => ({ ...current, [name]: value }))}
            required={(name) => name === "energyKcal"}
          />
          <p className={styles.authoritativeNote}>
            Nutrition is the total for this quantity. Changing quantity here
            does not change the values you entered.
          </p>
          <FoodLogFormActions date={date} message={actionData?.message}>
            <button className={styles.primaryButton} type="submit">
              {pending ? "Adding…" : "Add to Food Log"}
            </button>
          </FoodLogFormActions>
        </fieldset>
      </Form>
    </section>
  );
}

function FoodLogFormActions({ date, message, children }: { date: string; message?: string; children: ReactNode }) {
  return <>
    {message ? <p className={styles.catalogError} role="alert">{message}</p> : null}
    <div className={styles.dialogActions}>
      <Link className={styles.secondaryButton} to={foodLogHref(date)}>Cancel</Link>
      {children}
    </div>
  </>;
}

function offCalculationMessage(reason: string | undefined) {
  const messages: Record<string, string> = {
    ambiguous_nutrition_basis: "Calculation unavailable: this export does not establish whether nutrition is per 100 g or 100 ml. Package size and serving text cannot resolve it.",
    conflicting_nutrition_bases: "Calculation unavailable: the product has conflicting nutrition bases.",
    invalid_nutrition_input_sets: "Calculation unavailable: the source nutrition input sets have an invalid structure.",
    invalid_nutrition_reference: "Calculation unavailable: the source nutrition reference quantity or unit is invalid.",
    unsupported_nutrition_authority: "Calculation unavailable: no supported packaging nutrition for the product as sold is provided.",
    calories_unavailable: "Calculation unavailable: calories are missing or have an unsupported unit.",
    nutrition_not_provided: "Calculation unavailable: nutrition is not provided for this product.",
    unsupported_barcode: "This product does not have a supported commercial barcode.",
  };
  return reason && Object.hasOwn(messages, reason) ? messages[reason] : "Calculation unavailable for this product.";
}

function BarcodeFoodDetail({
  actionData,
  backHref,
  backLabel,
  csrfToken,
  date,
  food,
  idempotencyKey,
}: {
  actionData: HomeActionData | undefined;
  backHref: string;
  backLabel: string;
  csrfToken: string;
  date: string;
  food: CatalogFood;
  idempotencyKey: string;
}) {
  const [quantity, setQuantity] = useState("1");
  const [measurementId, setMeasurementId] = useState(food.measurements[0]?.id ?? "");
  const measurement = food.measurements.find(value => value.id === measurementId);
  const quantityMicrounits = quantityMicrounitsFromDecimal(quantity);
  const multiplier =
    quantityMicrounits === undefined ? 0 : (quantityMicrounits / 1_000_000) * (measurement?.baseQuantityMicrounits ?? 0) / food.authoritativeBaseQuantityMicrounits;
  const displayName =
    food.name === "Unnamed product" && food.barcode
      ? `Unnamed product · ${food.barcode}`
      : food.name;

  return (
    <section aria-labelledby="barcode-product-title">
      <Link
        className={styles.backToResults}
        to={backHref}
      >
        {backLabel}
      </Link>
      <div className={styles.foodIdentity}>
        <span className={styles.catalogType}>Open Food Facts</span>
        <h3 id="barcode-product-title">{displayName}</h3>
        <p>Barcode {food.barcode}</p>
        {food.brand ? <p>{food.brand}</p> : null}
      </div>
      <div className={styles.snapshotNote}>
        <span aria-hidden="true">◇</span>
        <p>
          <strong>Saved as a Nutrition Snapshot</strong>
          Confirm to keep these nutrition values and source details locally if
          Open Food Facts later changes or is unavailable.
        </p>
      </div>
      <Form className={styles.logFoodForm} method="post">
        <input name="csrfToken" type="hidden" value={csrfToken} />
        <input name="date" type="hidden" value={date} />
        <input name="idempotencyKey" type="hidden" value={idempotencyKey} />
        <input name="intent" type="hidden" value="log-food" />
        <input name="provider" type="hidden" value={food.provider} />
        {food.catalogGeneration ? <input name="catalogGeneration" type="hidden" value={food.catalogGeneration} /> : null}
        <input
          name="providerFoodId"
          type="hidden"
          value={food.providerFoodId}
        />
        {!food.isSelectable ? <p role="alert" className={styles.catalogError}>{offCalculationMessage(food.calculationUnavailableReason)}</p> : null}
        <div className={styles.foodDetailGrid}>
          <label className={styles.stackedField}>
            <span>Measurement</span>
            <select aria-label="Measurement" name="selectedMeasurementId" value={measurementId} onChange={event => setMeasurementId(event.currentTarget.value)} disabled={!food.isSelectable}>
              {food.measurements.map(value => <option key={value.id} value={value.id}>{value.label}</option>)}
            </select>
            <small>Nutrition uses the source's supported quantity and unit.</small>
          </label>
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
        {food.isSelectable ? <CatalogNutritionPreview
          carbohydrateLabel="Carbohydrates"
          food={food}
          includeAdditional
          multiplier={multiplier}
        /> : null}
        <FoodLogFormActions date={date} message={actionData?.message}>
          <button
            className={styles.primaryButton}
            disabled={!food.isSelectable || !measurement || quantityMicrounits === undefined}
            type="submit"
          >
            Add to Food Log
          </button>
        </FoodLogFormActions>
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
  const scannerKey = catalog.barcode || "new-scan";

  if (catalog.food && !catalog.message && !pending) {
    return (
      <BarcodeFoodDetail
        actionData={actionData}
        backHref={catalogHref(date, "barcode")}
        backLabel="‹ Back to scanner"
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
          (detectedBarcode) => {
            setBarcode(detectedBarcode);
            setClientMessage(undefined);
            void navigate(barcodeCatalogHref(date, detectedBarcode));
          }
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
    new URLSearchParams(navigation.location?.search).get("provider"),
  );
  const detailPending =
    catalog.mode === "search" &&
    (pendingFoodStage?.mode === "detail" || pendingFoodStage?.mode === "saved");
  const searchPending =
    navigation.state !== "idle" &&
    !detailPending;
  const barcodePending = pendingFoodStage?.mode === "barcode";
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
            {catalog.mode !== "choose" ? (
              <>
                <span className={styles.dialogChip}>
                  {catalog.mode === "search" || catalog.mode === "detail"
                    ? "USDA food catalog"
                    : catalog.mode === "my" || catalog.mode === "saved"
                      ? "My foods"
                    : catalog.mode === "barcode"
                      ? "Open Food Facts"
                      : "Manual"}
                </span>
                <p>Nothing changes in your Food Log until a later confirmation step.</p>
              </>
            ) : null}
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
        ) : catalog.mode === "detail" && catalog.food.provider === "open-food-facts" ? (
          <BarcodeFoodDetail
            actionData={actionData}
            backHref={catalogHref(date, "search", catalog.query)}
            backLabel="‹ Back to results"
            csrfToken={csrfToken}
            date={date}
            food={catalog.food}
            idempotencyKey={catalog.idempotencyKey}
          />
        ) : catalog.mode === "detail" ? (
          <FoodDetailStage
            actionData={actionData}
            catalog={catalog}
            csrfToken={csrfToken}
            date={date}
          />
        ) : catalog.mode === "choose" ? (
          <CatalogChoiceStage date={date} photoCapture={photoCapture} />
        ) : catalog.mode === "my" ? (
          <MyFoodsStage catalog={catalog} date={date} />
        ) : catalog.mode === "saved" ? (
          <SavedFoodStage
            actionData={actionData}
            catalog={catalog}
            csrfToken={csrfToken}
            date={date}
          />
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
              <label htmlFor="food-query">Search local foods</label>
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
                <h3>Searching USDA foods</h3>
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
                {catalog.savedResults.length > 0 ? (
                  <section aria-label="My foods">
                    <h3>My foods</h3>
                    <SavedFoodResults
                      date={date}
                      foods={catalog.savedResults}
                      query={catalog.query}
                    />
                  </section>
                ) : null}
                {catalog.message ? (
                  <div className={styles.catalogState} role="alert">
                    <h3>{catalog.title ?? "Search unavailable"}</h3>
                    <p>{catalog.message}</p>
                  </div>
                ) : null}
                {catalog.results.length > 0 ? (
                  <div
                    className={styles.catalogResults}
                    aria-label="Food search results"
                  >
                    {catalog.results.map((result) => {
                      const identity = (
                        <span>
                          <strong>{result.name}</strong>
                          <small>
                            {[result.brand, result.measurementSummary, result.catalogGeneration ? result.providerPublishedDate : null]
                              .filter(Boolean)
                              .join(" · ")}
                          </small>
                        </span>
                      );
                      return result.isSelectable ? (
                        <Link
                          key={`${result.provider}:${result.providerFoodId}`}
                          to={catalogHref(
                            date,
                            result.providerFoodId,
                            catalog.query,
                            result.provider,
                          )}
                        >
                          {identity}
                          <small>Select ›</small>
                        </Link>
                      ) : (
                        <div aria-disabled="true" key={`${result.provider}:${result.providerFoodId}`}>
                          {identity}
                          <small>{result.catalogGeneration
                            ? "Nutrition unavailable"
                            : "Hidden in production"}</small>
                        </div>
                      );
                    })}
                  </div>
                ) : catalog.message || catalog.savedResults.length ? null : catalog.query ? (
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
                      Search ingredients from USDA Foundation.
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

function FoodTimelineEntry({ entry, photoMeal, csrfToken }: {
  entry: Extract<Route.ComponentProps["loaderData"]["foodLog"]["events"][number], { kind: "food" }>;
  photoMeal?: Route.ComponentProps["loaderData"]["photoMeals"][number];
  csrfToken: string;
}) {
  const correction = useFetcher<{ error?: string }>({
    key: photoMeal ? `photo-correction:${photoMeal.id}` : undefined,
  });
  const startingCorrection = correction.state !== "idle";
  const active = startingCorrection || photoMeal?.status === "active";
  const unsuccessful = !active && photoMeal !== undefined && photoMeal.status !== "succeeded";
  const ContentTag = unsuccessful ? "div" : "span";
  const expandable = active || unsuccessful;
  const className = styles.foodEntryCard;
  const content = (
    <>
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
      <ContentTag className={styles.foodEntryContent}>
        <strong>{entry.name}</strong>
        <small>
          {entry.provider === "open-food-facts"
            ? "Open Food Facts"
            : entry.provider === "manual"
              ? "Manual"
            : entry.provider === "ai-photo" ? "AI photo estimate"
            : `USDA FoodData Central · ${entry.dataType}`}
        </small>
        <small className={unsuccessful ? styles.photoFailedStatus : undefined} role={expandable ? "status" : undefined}>
          {active ? (
            <><span className={styles.photoActivityDot} aria-hidden="true" />{startingCorrection ? "Starting correction" : "Analyzing photo"}</>
          ) : unsuccessful ? (
            photoMeal.status === "failed" ? "Analysis failed" : photoMeal.status === "canceled" ? "Analysis canceled" : "Analysis interrupted"
          ) : (
            <>{entry.selectedMeasurementLabel} × {entry.quantityMicrounits / 1_000_000}</>
          )}
        </small>
        {unsuccessful && photoMeal.error ? <PhotoFailureReason error={photoMeal.error} /> : null}
        {unsuccessful ? (
          <Link className={styles.photoRecoveryLink} data-entry-editor-trigger to={`${foodLogHref(entry.foodLogDate)}&entry=${entry.id}`}>
            Open meal details
          </Link>
        ) : null}
      </ContentTag>
      <span className={styles.foodEntryEnergy}>
        {formatEnergy(entry.energyMilliKcal)}{" "}
        <small>kcal</small>
      </span>
    </>
  );
  return (
    <article aria-busy={active || undefined}>
      {unsuccessful && photoMeal ? (
        <div className={`${styles.foodEntryCard} ${styles.photoRecoveryCard}`}>
          {content}
          <PhotoMealStatus meal={photoMeal} csrfToken={csrfToken} inline />
        </div>
      ) : expandable ? (
        <details className={styles.photoCorrectionDetails}>
          <summary className={className}>{content}</summary>
          <div className={styles.photoEntryStatus}>
            {photoMeal && !startingCorrection ? (
              <PhotoMealStatus meal={photoMeal} csrfToken={csrfToken} />
            ) : (
              <p>Starting correction. Previous nutrition retained.</p>
            )}
          </div>
        </details>
      ) : (
        <Link className={className} data-entry-editor-trigger to={`${foodLogHref(entry.foodLogDate)}&entry=${entry.id}`}>
          {content}
        </Link>
      )}
      {!active && correction.data?.error ? (
        <p className={styles.catalogError} role="alert">
          Correction could not start: {correction.data.error} Open this meal to try again.
        </p>
      ) : null}
    </article>
  );
}

function PhotoTimelineEntry({ children }: {
  children: ReactNode;
}) {
  return (
    <article className={`${styles.foodEntryCard} ${styles.photoTimelineEntry}`}>
      <span className={styles.pendingTime} />
      <span className={styles.foodEntryMarker} aria-hidden="true">
        <UiIcon name="utensils" />
      </span>
      <div className={styles.photoTimelineContent}>{children}</div>
    </article>
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
  pending: editorPending,
}: {
  csrfToken: string;
  entry: EditableFoodEntry;
  idempotencyKey: string;
  pending: boolean;
}) {
  const navigation = useNavigation();
  const [open, setOpen] = useState(false);
  const copyPending =
    navigation.formData?.get("intent") === "copy-food-to-today" &&
    navigation.formData.get("entryId") === String(entry.id);

  return (
    <div className={styles.editorCopyMenu}>
      <button
        aria-expanded={open}
        aria-label="Copy entry"
        className={styles.editIconButton}
        disabled={editorPending}
        onClick={() => setOpen((current) => !current)}
        title="Copy entry"
        type="button"
      >
        <UiIcon name="copy" />
      </button>
      {open ? (
        <div className={styles.editorCopyMenuPopover}>
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
              disabled={editorPending || copyPending}
              name="intent"
              type="submit"
              value="copy-food-to-today"
            >
              {copyPending ? "Copying…" : "Copy to today"}
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
    restoreFocusSelector: `[data-entry-editor-trigger][href="${closeHref}&entry=${dialog.entry.id}"]`,
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

export default function Home({ actionData, loaderData }: Route.ComponentProps) {
  const {
    calendar,
    catalog,
    copyDialog,
    copyError,
    copyIdempotencyKeys,
    csrfToken,
    dailyCalories = {},
    foodEntryEditor,
    manualEntrySaved,
    foodLog,
    photoMeals = [],
    photoAnalysisReadiness = { state: "ready" as const },
    nearbyDates,
    notice,
    waterDialog,
  } = loaderData;
  const photoUpload = usePhotoUpload(
    foodLog.selectedDate,
    csrfToken,
    photoAnalysisReadiness,
  );
  usePhotoMealPolling(photoMeals);
  const activeFoodEntryEditor =
    actionData?.foodEntryEditor ?? foodEntryEditor;
  const selectedLabel = fullDate(foodLog.selectedDate);
  const navigation = useNavigation();
  const showQuickLog = !calendar && !foodLog.isFuture;
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
        className={`${styles.shell} ${styles.foodLogShell}`}
        inert={
          visibleCatalog || activeFoodEntryEditor || waterDialog || copyDialog
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
          floatingActions={
            showQuickLog ? (
              <QuickLogActions
                csrfToken={csrfToken}
                date={foodLog.selectedDate}
              />
            ) : undefined
          }
          selectedDate={foodLog.selectedDate}
          today={foodLog.today}
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
          </header>

          {calendar ? (
            <CalendarView
              calendar={calendar}
              dailyCalories={dailyCalories}
              selectedDate={foodLog.selectedDate}
            />
          ) : (
            <section aria-label="Food Log" className={styles.foodLogLayout}>
              <DateRail
                key={foodLog.selectedDate}
                nearbyDates={nearbyDates.map((day) => ({
                  ...day,
                  calories: calorieDaySummary(dailyCalories[day.date]),
                }))}
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
                ) : foodLog.events.length || foodLogPending || photoUpload.feedback || photoMeals.length ? (
                  <section className={styles.entryList} aria-label="Daily log entries">
                    {foodLogPending ? (
                      <PendingFoodEntry name={pendingFoodName} />
                    ) : null}
                    {photoUpload.feedback ? (
                      <PhotoTimelineEntry>
                        {photoUpload.feedback}
                      </PhotoTimelineEntry>
                    ) : null}
                    {photoMeals.filter((meal) => meal.entryId === null).map((meal) => (
                      <PhotoMealCard key={meal.id} meal={meal} csrfToken={csrfToken} />
                    ))}
                    {foodLog.events.map((entry) => {
                      return entry.kind === "food" ? (
                        <FoodTimelineEntry key={`food-${entry.id}`} entry={entry} photoMeal={photoMeals.find((meal) => meal.entryId === entry.id)} csrfToken={csrfToken} />
                      ) : (
                        <WaterTimelineItem
                          displayUnits={foodLog.displayUnits}
                          editHref={`${foodLogHref(foodLog.selectedDate)}&water=${entry.id}`}
                          event={entry}
                          icon={<UiIcon name="water" />}
                          key={`water-${entry.id}`}
                          timeZone={foodLog.timeZone}
                        />
                      );
                    })}
                    {actionData?.message ? (
                      <p className={styles.actionMessage} role="status">
                        {actionData.message}
                      </p>
                    ) : null}
                  </section>
                ) : (
                  <div className={styles.emptyDay}>
                    <span className={styles.emptyIcon} aria-hidden="true">
                      □
                    </span>
                    <h3>No entries for this day</h3>
                    <p>
                      {foodLog.selectedDate === foodLog.today
                        ? "Add food or water when you’re ready."
                        : "Past-day entries start at 12:00 PM. Add food or water when you’re ready."}
                    </p>
                    <QuickLogActions
                      csrfToken={csrfToken}
                      date={foodLog.selectedDate}
                      inline
                    />
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
          copyKey={copyIdempotencyKeys[activeFoodEntryEditor.id]}
          csrfToken={csrfToken}
          entry={activeFoodEntryEditor}
          manualEntrySaved={manualEntrySaved}
          photoMeal={photoMeals.find((meal) => meal.entryId === activeFoodEntryEditor.id)}
          key={activeFoodEntryEditor.updatedAt}
        />
      ) : null}
      {waterDialog ? (
        <WaterDialogModal
          csrfToken={csrfToken}
          date={foodLog.selectedDate}
          dialog={waterDialog}
          key={waterDialog.event?.updatedAt ?? "create"}
        />
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
