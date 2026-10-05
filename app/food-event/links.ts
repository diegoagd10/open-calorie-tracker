import { isSupportedCommercialBarcode } from "../barcode";
import type { CatalogProviderId } from "../catalog/food-catalog.server";

/** Home URLs that open Food Event dialogs, and how Home's `food=` parameter reads. */

/**
 * The fetcher keys Food Event dialogs submit with; one dialog of each kind is open at a time.
 * Home reads the add fetcher to show a catalog save's pending row.
 */
export const FOOD_EVENT_FETCHERS = {
  add: "food-event:add",
  addFavorite: "food-event:add-favorite",
  copy: "food-event:copy",
  copyToToday: "food-event:copy-to-today",
  edit: "food-event:edit",
} as const;

export function foodLogHref(date: string, parameters: Record<string, string> = {}): string {
  return `/?${new URLSearchParams({ date, ...parameters })}`;
}

export function addFoodHref(date: string, food: string, query?: string, provider?: CatalogProviderId): string {
  const parameters = new URLSearchParams({ date, food });
  if (query) parameters.set("query", query);
  if (provider) parameters.set("provider", provider);
  return `/?${parameters}`;
}

export function barcodeHref(date: string, barcode: string): string {
  return `/?${new URLSearchParams({ barcode, date, food: "barcode" })}`;
}

export function editorHref(date: string, eventId: number): string {
  return `${foodLogHref(date)}&entry=${eventId}`;
}

export function copyHref(
  sourceDate: string,
  eventId: number,
  options: { destinationDate?: string; month?: string } = {},
): string {
  const parameters = new URLSearchParams({ date: sourceDate, copy: String(eventId) });
  if (options.destinationDate) parameters.set("copyDate", options.destinationDate);
  if (options.month) parameters.set("copyMonth", options.month);
  return `/?${parameters}`;
}

export type AddFoodRoute =
  | { mode: "barcode" }
  | { mode: "choose" }
  | { mode: "detail"; provider: CatalogProviderId; providerFoodId: string }
  | { mode: "manual" }
  | { mode: "my" }
  | { mode: "saved"; favoriteId: number }
  | { mode: "search" };

export function positiveIntegerId(value: string | null): number | undefined {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 && String(id) === value ? id : undefined;
}

/** The Add Food step that Home's `food=` and `provider=` parameters ask for, or undefined. */
export function addFoodRoute(value: string | null, requestedProvider: string | null): AddFoodRoute | undefined {
  if (value === "search") return { mode: "search" };
  if (value === "choose") return { mode: "choose" };
  if (value === "barcode") return { mode: "barcode" };
  if (value === "manual") return { mode: "manual" };
  if (value === "my") return { mode: "my" };
  if (value?.startsWith("saved:")) {
    const favoriteId = positiveIntegerId(value.slice(6));
    if (favoriteId !== undefined) return { mode: "saved", favoriteId };
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

/** A trimmed search of 2 to 100 characters, or undefined. */
export function catalogQuery(value: string): string | undefined {
  const query = value.trim();
  return query.length >= 2 && query.length <= 100 ? query : undefined;
}

/** A trimmed supported commercial barcode, or undefined. */
export function catalogBarcode(value: string): string | undefined {
  const barcode = value.trim();
  return isSupportedCommercialBarcode(barcode) ? barcode : undefined;
}
