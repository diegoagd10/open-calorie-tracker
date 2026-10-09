import { randomUUID } from "node:crypto";

import { redirect } from "react-router";

import type { CatalogOperationContext, CatalogSearchResult, FoodCatalog } from "../catalog/food-catalog.server";
import { CatalogFoodNotFoundError } from "../catalog/food-catalog.server";
import { getFoodCatalog, getOpenFoodFactsClient } from "../catalog/runtime.server";
import { testRequestInstant } from "../runtime.server";
import { buildCalendarMonth, parseIsoLocalDate } from "../shared/local-date";
import type {
  AddFoodStage,
  BarcodeLookupAccess,
  CopyFoodEventDialogModel,
  FoodEvent,
  FoodEventDialogs,
} from "./food-event.model";
import { FoodEventNotFoundError } from "./food-event.exceptions";
import { localDay, type FoodEventService } from "./food-event.server";
import { addFoodHref, addFoodRoute, catalogBarcode, catalogQuery, positiveIntegerId, type AddFoodRoute } from "./links";
import { catalogFailure } from "./methods/catalog.server";
import { getFoodEventService } from "./runtime.server";

/** The parts of Home's Food Log that decide which dialogs may open. */
export type FoodLogDay = { selectedDate: string; today: string; isFuture: boolean; timeZone: string };

/** The request Home is answering, for whom. */
export type HomeRequest = { request: Request; userId: number; role: string };

type Reads = {
  service: FoodEventService;
  catalog: FoodCatalog;
  context: CatalogOperationContext;
  userId: number;
};

/** Scan barcode is usable once an administrator set the Open Food Facts contact. */
function barcodeLookupAccess(role: string): BarcodeLookupAccess {
  if (getOpenFoodFactsClient().isConfigured()) return "enabled";
  return role === "admin" ? "admin-setup" : "hidden";
}

/** An owned event on `date`, or a 404 for anything else. */
function eventOnDay(service: FoodEventService, userId: number, eventId: number | undefined, day: FoodLogDay): FoodEvent {
  try {
    const event = service.read(userId, eventId ?? 0);
    if (localDay(event.logDate, day.timeZone) !== day.selectedDate) throw new FoodEventNotFoundError();
    return event;
  } catch (error) {
    if (error instanceof FoodEventNotFoundError) throw new Response("Food Entry is unavailable.", { status: 404 });
    throw error;
  }
}

function copyDialog(url: URL, service: FoodEventService, userId: number, day: FoodLogDay): CopyFoodEventDialogModel | undefined {
  const event = eventOnDay(service, userId, positiveIntegerId(url.searchParams.get("copy")), day);
  const requested = url.searchParams.get("copyDate");
  const destinationDate = requested && parseIsoLocalDate(requested) && requested <= day.today && requested !== day.selectedDate
    ? requested
    : undefined;
  const calendar = buildCalendarMonth(
    url.searchParams.get("copyMonth") ?? day.selectedDate.slice(0, 7),
    day.today,
    destinationDate ?? "",
  );
  return {
    event,
    sourceDate: day.selectedDate,
    destinationDate,
    calendar: { ...calendar, days: calendar.days.map((calendarDay) => ({ ...calendarDay, isSource: calendarDay.date === day.selectedDate })) },
  };
}

async function searchStage(reads: Reads, requestedQuery: string): Promise<{ stage: AddFoodStage; status: number }> {
  const { service, catalog, context, userId } = reads;
  if (!requestedQuery) {
    return { stage: { mode: "search", query: "", results: [], favorites: service.findFavorites(userId, { query: "" }) }, status: 200 };
  }
  const query = catalogQuery(requestedQuery);
  if (query === undefined) {
    return {
      stage: {
        mode: "search",
        query: requestedQuery,
        results: [],
        favorites: [],
        message: "Enter a food search from 2 to 100 characters.",
        title: "Search not sent",
      },
      status: 400,
    };
  }
  // My foods stay searchable when USDA is unavailable.
  const favorites = service.findFavorites(userId, { query });
  try {
    return { stage: { mode: "search", query, results: await catalog.search(query, context), favorites }, status: 200 };
  } catch (error) {
    const failure = catalogFailure(error, "lookup");
    if (!failure) throw error;
    return { stage: { mode: "search", query, results: [], favorites, message: failure.message, title: failure.title }, status: failure.status };
  }
}

async function barcodeStage(catalog: FoodCatalog, requested: string): Promise<{ stage: AddFoodStage; status: number }> {
  if (!requested) return { stage: { mode: "barcode", barcode: "" }, status: 200 };
  const barcode = catalogBarcode(requested);
  if (barcode === undefined) {
    return {
      stage: { mode: "barcode", barcode: requested, message: "Enter a supported 7, 8, 12, 13, or 14 digit barcode.", title: "Barcode not valid" },
      status: 400,
    };
  }
  try {
    return { stage: { mode: "barcode", barcode, food: await catalog.lookupBarcode(barcode) }, status: 200 };
  } catch (error) {
    const failure = catalogFailure(error, "barcode");
    if (!failure) throw error;
    return { stage: { mode: "barcode", barcode, message: failure.message, title: failure.title }, status: failure.status };
  }
}

/** A USDA food's review screen; a vanished food returns to the search without it. */
async function detailStage(reads: Reads, route: Extract<AddFoodRoute, { mode: "detail" }>, query: string): Promise<{ stage: AddFoodStage; status: number }> {
  const { service, catalog, context, userId } = reads;
  if (route.provider === "open-food-facts") {
    const { stage, status } = await barcodeStage(catalog, route.providerFoodId);
    return stage.mode === "barcode" && stage.food ? { stage: { mode: "detail", query, food: stage.food }, status } : { stage, status };
  }
  try {
    return { stage: { mode: "detail", query, food: await catalog.getFood(route.provider, route.providerFoodId, context) }, status: 200 };
  } catch (error) {
    const failure = catalogFailure(error, "lookup");
    if (!failure) throw error;
    let results: CatalogSearchResult[] = [];
    const parsedQuery = catalogQuery(query);
    if (error instanceof CatalogFoodNotFoundError && parsedQuery !== undefined) {
      try {
        results = (await catalog.search(parsedQuery, context)).filter((result) => result.providerFoodId !== route.providerFoodId);
      } catch {
        // The original detail failure remains the useful response when refreshing the
        // surrounding search results also fails.
      }
    }
    return {
      stage: { mode: "search", query, results, favorites: service.findFavorites(userId, { query }), message: failure.message, title: failure.title },
      status: failure.status,
    };
  }
}

async function addFoodStage(url: URL, reads: Reads, route: AddFoodRoute): Promise<{ stage: AddFoodStage; status: number }> {
  const query = url.searchParams.get("query") ?? "";
  switch (route.mode) {
    case "choose":
    case "manual":
      return { stage: { mode: route.mode }, status: 200 };
    case "my":
      return { stage: { mode: "my", query: query.trim(), favorites: reads.service.findFavorites(reads.userId, { query: query.trim() }) }, status: 200 };
    case "saved": {
      const [favorite] = reads.service.findFavorites(reads.userId, { favoriteId: route.favoriteId });
      if (!favorite) throw new Response("That food is no longer in My foods.", { status: 404 });
      return { stage: { mode: "saved", query, favorite }, status: 200 };
    }
    case "barcode":
      return barcodeStage(reads.catalog, url.searchParams.get("barcode") ?? "");
    case "search":
      return searchStage(reads, query);
    case "detail":
      return detailStage(reads, route, query);
  }
}

/**
 * Home's Food Event read model: parses `food=`, `entry=`, and `copy=`, reads catalog
 * discovery and favorites, and answers which dialog to show with the response status it implies.
 * Returns a redirect when Scan barcode is not available to the account.
 */
export async function loadFoodEventDialogs(
  { request, userId, role }: HomeRequest,
  day: FoodLogDay,
): Promise<Response | { dialogs: FoodEventDialogs; status: number }> {
  const url = new URL(request.url);
  const service = getFoodEventService(testRequestInstant(request));
  const barcodeLookup = barcodeLookupAccess(role);
  const dialogs: FoodEventDialogs = { barcodeLookup };
  let status = 200;

  if (url.searchParams.get("entry") !== null && !day.isFuture) {
    const event = eventOnDay(service, userId, positiveIntegerId(url.searchParams.get("entry")), day);
    dialogs.editor = { event, canCopy: day.selectedDate < day.today };
  }

  if (url.searchParams.get("copy") !== null && day.selectedDate < day.today) {
    try {
      dialogs.copy = copyDialog(url, service, userId, day);
    } catch (error) {
      if (!(error instanceof Response && error.status === 404)) throw error;
      dialogs.copyError = "That Food Entry is unavailable. Choose another entry.";
    }
  }

  const route = addFoodRoute(url.searchParams.get("food"), url.searchParams.get("provider"));
  if (route && !day.isFuture) {
    if (route.mode === "barcode" && barcodeLookup !== "enabled") return redirect(addFoodHref(day.selectedDate, "choose"));
    const reads: Reads = {
      service,
      catalog: getFoodCatalog(),
      context: { requestId: request.headers.get("x-open-calory-request-id") ?? randomUUID() },
      userId,
    };
    const added = await addFoodStage(url, reads, route);
    dialogs.addFood = added.stage;
    status = added.status;
  }
  return { dialogs, status };
}
