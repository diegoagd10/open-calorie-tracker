import path from "node:path";
import express, { type Express, type Request, type Response } from "express";
import multer from "multer";
import { fileURLToPath } from "node:url";
import { applyMigrations } from "./db/migrations.js";
import { openDatabase, type DatabaseConnection } from "./db/client.js";
import { loadConfig, type AppConfig } from "./config.js";
import { estimateNutrition, normalizeNutrition, summarizeNutrition, type FoodProfile, type NutritionEstimateInput, type NutrientKey, type NutrientReferences, type MealTag } from "./domain/nutrition.js";
import { ProviderFailure } from "./adapters/errors.js";
import { OpenFoodFactsAdapter } from "./adapters/open-food-facts.js";
import { OpenAiLabelAdapter, validateImageInput } from "./adapters/label.js";
import { OpenAiFoodAdapter } from "./adapters/ai.js";
import type { AiFoodAdapter, BarcodeAdapter, FoodCandidate, FoodImageAnalysis, FoodSearchAdapter, IngredientProposal, LabelCandidateAdapter } from "./adapters/types.js";
import { ImageStorage } from "./storage/images.js";
import { Store, deleteAllOwnedData, utcFromLocal, writeExport, type FoodEntryRecord, type FoodRecord, type MealRecord } from "./persistence/store.js";
import { logger as defaultLogger, type TechnicalLogger } from "./infra/logger.js";
import { escapeHtml, renderEmptyState, renderFoodEntry, renderFoodCard, renderMealCard, renderNutritionList, renderPage, renderReferenceTable, renderReviewSurface, renderSummary } from "./http/render.js";

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const publicDirectory = path.resolve(sourceDirectory, "../public");

export interface ApplicationOptions {
  config?: Partial<AppConfig>;
  dataDir?: string;
  connection?: DatabaseConnection;
  store?: Store;
  barcodeAdapter?: BarcodeAdapter;
  searchAdapter?: FoodSearchAdapter;
  labelAdapter?: LabelCandidateAdapter;
  aiAdapter?: AiFoodAdapter;
  imageStorage?: ImageStorage;
  logger?: TechnicalLogger;
  migrate?: boolean;
}

export interface Application {
  app: Express;
  config: AppConfig;
  store: Store;
  connection: DatabaseConnection;
  close(): void;
}

type StoredCandidate = FoodCandidate & { buffer?: Buffer; mimeType?: string; originalName?: string };

function text(value: unknown, fallback = ""): string {
  if (Array.isArray(value)) return text(value[0], fallback);
  return typeof value === "string" ? value : value === undefined || value === null ? fallback : String(value);
}

function numberOrNull(value: unknown): number | null {
  const raw = text(value).trim();
  if (!raw) return null;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error("Enter a finite number or leave the field blank.");
  return parsed;
}

function numberRequired(value: unknown, label: string): number {
  const parsed = numberOrNull(value);
  if (parsed === null) throw new Error(`${label} is required and must be a number.`);
  return parsed;
}

function positiveNumber(value: unknown, label: string): number {
  const parsed = numberRequired(value, label);
  if (parsed <= 0) throw new Error(`${label} must be greater than zero.`);
  return parsed;
}

function currentLocalDate(timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function localTime(timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.hour}:${values.minute}`;
}

function shiftDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function longLocalDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`));
}

function localDateFor(utc: string, timezone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(utc));
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function candidateProfile(candidate: StoredCandidate): FoodProfile {
  const nutrients = normalizeNutrition(candidate.nutrients);
  if (nutrients.calories === null) throw new Error("Calories are required before confirmation.");
  const name = candidate.name.trim();
  const quantityBasis = candidate.quantityBasis.trim();
  if (!name) throw new Error("Food name is required before confirmation.");
  if (!quantityBasis) throw new Error("A declared quantity basis is required before confirmation.");
  const basisQuantity = candidate.basisQuantity ?? 1;
  if (!Number.isFinite(basisQuantity) || basisQuantity <= 0) throw new Error("Declared basis quantity must be greater than zero.");
  return {
    name,
    brand: candidate.brand ?? null,
    description: candidate.description ?? null,
    quantityBasis,
    basisQuantity,
    nutrients: { ...nutrients, calories: nutrients.calories },
    source: candidate.source,
  };
}

function candidateReviewProfile(candidate: StoredCandidate): Omit<FoodProfile, "nutrients"> & { nutrients: StoredCandidate["nutrients"] } {
  return {
    name: candidate.name,
    brand: candidate.brand ?? null,
    description: candidate.description ?? null,
    quantityBasis: candidate.quantityBasis,
    basisQuantity: candidate.basisQuantity ?? 1,
    nutrients: candidate.nutrients,
    source: candidate.source,
  };
}

function candidateProfileFromRequest(candidate: StoredCandidate, body: Record<string, unknown>): FoodProfile {
  const profile = candidateReviewProfile(candidate);
  const calories = numberRequired(body.calories ?? profile.nutrients.calories, "Calories");
  const name = text(body.name, profile.name).trim();
  const quantityBasis = text(body.quantityBasis, profile.quantityBasis).trim();
  const basisQuantity = positiveNumber(body.basisQuantity ?? profile.basisQuantity ?? 1, "Basis quantity");
  if (!name) throw new Error("Food name is required before confirmation.");
  if (!quantityBasis) throw new Error("A declared quantity basis is required before confirmation.");
  return {
    name,
    brand: profile.brand,
    description: profile.description,
    quantityBasis,
    basisQuantity,
    nutrients: {
      calories,
      protein: numberOrNull(body.protein ?? profile.nutrients.protein),
      carbohydrates: numberOrNull(body.carbohydrates ?? profile.nutrients.carbohydrates),
      fat: numberOrNull(body.fat ?? profile.nutrients.fat),
      fiber: numberOrNull(body.fiber ?? profile.nutrients.fiber),
      addedSugar: numberOrNull(body.addedSugar ?? profile.nutrients.addedSugar),
      sugar: numberOrNull(body.sugar ?? profile.nutrients.sugar),
      saturatedFat: numberOrNull(body.saturatedFat ?? profile.nutrients.saturatedFat),
      sodium: numberOrNull(body.sodium ?? profile.nutrients.sodium),
    },
    source: candidate.source,
  };
}

function profileFromFood(food: FoodRecord): FoodProfile {
  return {
    name: food.name,
    brand: food.brand,
    description: food.description,
    quantityBasis: food.quantityBasis,
    basisQuantity: food.basisQuantity,
    nutrients: food.nutrients,
    source: food.source,
  };
}

function profileFromMeal(meal: MealRecord): FoodProfile {
  if (meal.nutrients.calories === null) throw new Error("Meal nutrition is missing required calories.");
  return { name: meal.name, description: meal.description, quantityBasis: "meal unit", basisQuantity: 1, nutrients: { ...meal.nutrients, calories: meal.nutrients.calories }, source: "Saved Meal" };
}

function profileFromEntry(entry: FoodEntryRecord): FoodProfile {
  if (entry.snapshot.baseNutrients.calories === null) throw new Error("Food entry nutrition is missing required calories.");
  return {
    name: entry.title,
    quantityBasis: entry.snapshot.quantityBasis,
    basisQuantity: entry.snapshot.basisQuantity,
    nutrients: { ...entry.snapshot.baseNutrients, calories: entry.snapshot.baseNutrients.calories },
    source: "Historical snapshot",
  };
}

function renderErrorPage(title: string, message: string, active: "scan" | "database" | "log" | "saved" = "scan", retry?: string, retryFields: Record<string, string> = {}, retryMethod: "get" | "post" = "post"): string {
  const hiddenRetryFields = Object.entries(retryFields).map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`).join("");
  return renderPage({
    title,
    active,
    content: `<section class="empty-state"><p class="eyebrow">Needs attention</p><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p>${retry ? `<form method="${retryMethod}" action="${escapeHtml(retry)}">${hiddenRetryFields}<button class="button" type="submit">Retry</button></form>` : ""}<p><a class="button button--secondary" href="/saved-foods">Create a manual Food</a></p></section>`,
  });
}

function providerFailureTitle(kind: ProviderFailure["kind"], subject: string): string {
  return {
    invalid: `${subject} input is invalid`,
    not_found: `${subject} not found`,
    incomplete: `${subject} is incomplete`,
    conflicting: `${subject} has conflicting data`,
    temporarily_unavailable: `${subject} is temporarily unavailable`,
    refused: `${subject} was refused`,
    unexpected: `${subject} failed unexpectedly`,
  }[kind];
}

function providerFailureGuidance(failure: ProviderFailure): string {
  if (failure.retryable) return "Retry when the provider is available.";
  if (failure.manualFallback) return "Use manual Food entry to continue; no unreviewed data was saved.";
  return "No data was saved.";
}

function parseProfileForm(body: Record<string, unknown>, fallback?: FoodProfile): FoodProfile {
  const name = text(body.name, fallback?.name).trim();
  const quantityBasis = text(body.quantityBasis, fallback?.quantityBasis).trim();
  const calories = numberRequired(body.calories ?? fallback?.nutrients.calories, "Calories");
  if (!name || !quantityBasis) throw new Error("Food name and declared quantity basis are required.");
  return {
    name,
    brand: text(body.brand, fallback?.brand ?? "").trim() || null,
    description: text(body.description, fallback?.description ?? "").trim() || null,
    quantityBasis,
    basisQuantity: positiveNumber(body.basisQuantity ?? fallback?.basisQuantity ?? 1, "Basis quantity"),
    nutrients: {
      calories,
      protein: numberOrNull(body.protein ?? fallback?.nutrients.protein),
      carbohydrates: numberOrNull(body.carbohydrates ?? fallback?.nutrients.carbohydrates),
      fat: numberOrNull(body.fat ?? fallback?.nutrients.fat),
      fiber: numberOrNull(body.fiber ?? fallback?.nutrients.fiber),
      addedSugar: numberOrNull(body.addedSugar ?? fallback?.nutrients.addedSugar),
      sugar: numberOrNull(body.sugar ?? fallback?.nutrients.sugar),
      saturatedFat: numberOrNull(body.saturatedFat ?? fallback?.nutrients.saturatedFat),
      sodium: numberOrNull(body.sodium ?? fallback?.nutrients.sodium),
    },
  };
}

function createManualFoodForm(food?: FoodRecord): string {
  const value = (key: string, fallback = "") => escapeHtml(food ? (food.nutrients as unknown as Record<string, unknown>)[key] ?? fallback : fallback);
  return `<section class="form-panel"><p class="eyebrow">${food ? "Edit reusable Food" : "Manual Food"}</p><h2>${food ? "Update Food" : "Create Food"}</h2><form method="post" action="${food ? `/foods/${food.id}` : "/foods"}" class="stack-form">
    <div class="form-grid"><label>Name <input name="name" value="${escapeHtml(food?.name)}" required></label><label>Brand <input name="brand" value="${escapeHtml(food?.brand)}"></label><label>Declared basis <input name="quantityBasis" value="${escapeHtml(food?.quantityBasis || "serving")}" placeholder="serving, item, cup" required></label><label>Basis quantity <input name="basisQuantity" value="${escapeHtml(food?.basisQuantity || 1)}" inputmode="decimal" required></label></div>
    <div class="form-grid"><label>Calories (kcal) <input name="calories" value="${value("calories")}" inputmode="decimal" required></label><label>Protein (g) <input name="protein" value="${value("protein")}" inputmode="decimal"></label><label>Total carbohydrates (g) <input name="carbohydrates" value="${value("carbohydrates")}" inputmode="decimal"></label><label>Fat (g) <input name="fat" value="${value("fat")}" inputmode="decimal"></label><label>Fiber (g) <input name="fiber" value="${value("fiber")}" inputmode="decimal"></label><label>Added sugar (g) <input name="addedSugar" value="${value("addedSugar")}" inputmode="decimal"></label><label>Total sugar (g) <input name="sugar" value="${value("sugar")}" inputmode="decimal"></label><label>Saturated fat (g) <input name="saturatedFat" value="${value("saturatedFat")}" inputmode="decimal"></label><label>Sodium (mg) <input name="sodium" value="${value("sodium")}" inputmode="decimal"></label></div>
    <label>Description <textarea name="description" rows="2">${escapeHtml(food?.description)}</textarea></label><button class="button" type="submit">${food ? "Save Food" : "Create Food"}</button></form>${food ? `<form method="post" action="/foods/${food.id}/image" enctype="multipart/form-data" class="stack-form"><label>Retained Food image <input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif"></label><button class="button button--secondary" type="submit">Attach image</button></form>` : ""}</section>`;
}

function renderLogPage(store: Store, config: AppConfig, date: string, notice = "", undoId?: string): string {
  const timezone = store.getTimezone(config.timezone);
  const user = store.getUser();
  const entries = store.listFoodEntriesByDate(date, timezone);
  const target = store.getActiveTarget();
  const references: NutrientReferences = { ...(target?.references ?? {}) };
  if (target?.calories !== null && target?.calories !== undefined) references.calories = { type: "target", value: target.calories, label: "confirmed calorie target" };
  const summary = summarizeNutrition(entries.map((entry) => entry.snapshot.nutrients), references);
  const noticeMarkup = notice ? `<p class="notice notice--success" role="status">${escapeHtml(notice)}${undoId ? ` <form style="display:inline" method="post" action="/entries/${encodeURIComponent(undoId)}/undo"><button class="link-button" type="submit">Undo</button></form>` : ""}</p>` : "";
  const current = date === currentLocalDate(timezone);
  const content = `${noticeMarkup}<section class="view-toolbar" aria-labelledby="log-heading">
      <div class="date-context"><div class="date-controls"><a class="icon-button icon-button--square" href="/log?date=${escapeHtml(shiftDate(date, -1))}" aria-label="Previous day">${renderNavIcon("chevron-left")}</a><div><p class="section-kicker">Daily log</p><h2 id="log-heading" class="date-heading">${escapeHtml(longLocalDate(date))}</h2><p class="date-meta">Local time <span class="meta-divider">/</span> ${escapeHtml(timezone)}</p></div><a class="icon-button icon-button--square" href="/log?date=${escapeHtml(shiftDate(date, 1))}" aria-label="Next day">${renderNavIcon("chevron-right")}</a></div>${current ? "" : `<a class="text-button today-button" href="/log">Return to today</a>`}</div>
      <div class="toolbar-actions"><details class="source-menu"><summary class="button button--primary">${renderNavIcon("plus")}<span>Add Food</span></summary><div class="source-options"><a href="/database"><strong>Food Database</strong><small>Search confirmed and external records</small></a><a href="/scan"><strong>Scan Food</strong><small>Capture a plate, barcode, or label</small></a><a href="/saved-foods"><strong>Saved Foods</strong><small>Reuse a confirmed Food or Meal</small></a></div></details></div>
    </section>
    <div class="date-jump"><form method="get" action="/log"><label for="log-date">Jump to date</label><input id="log-date" type="date" name="date" value="${escapeHtml(date)}"><button class="button button--secondary" type="submit">Open date</button></form><span>Stored timestamps use your configured local timezone.</span></div>
    ${renderSummary(summary, target)}
    <section class="log-feed" aria-labelledby="feed-heading"><div class="feed-heading"><div><h2 id="feed-heading">Food entries</h2><p>${entries.length ? `${entries.length} entr${entries.length === 1 ? "y" : "ies"}` : "No entries yet"} <span class="meta-divider">/</span> newest first</p></div><a class="text-button" href="/database">Add from source ${renderNavIcon("arrow-right", "icon--tiny")}</a></div><div class="entry-feed">${entries.length ? entries.map(renderFoodEntry).join("") : renderEmptyState("Start with a food entry", "Your daily log is empty. Choose a capture path above; nothing is saved until you confirm it.", "/saved-foods", "Open Saved Foods")}</div></section>
    <p class="workspace-footer"><a href="/settings/data">Your data and images</a><span>/</span><a href="/settings">Timezone settings</a></p>`;
  return renderPage({ title: `${date} Daily log`, active: "log", content, seedTimezone: !user || user.timezoneSource === "bootstrap" });
}

function renderNavIcon(name: string, className = ""): string {
  return `<svg class="icon${className ? ` ${className}` : ""}" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
}

function renderDatabasePage(store: Store, config: AppConfig, options: { query?: string; filter?: string; candidates?: FoodCandidate[]; error?: string } = {}): string {
  const filter = options.filter || "all";
  const foods = filter === "meals" ? [] : store.listFoods({ search: options.query, filter: filter === "favorites" ? "favorites" : filter === "foods" ? "foods" : "all" });
  const meals = filter === "meals" || filter === "all" || filter === "favorites" ? store.listMeals({ search: options.query, favoritesOnly: filter === "favorites" }) : [];
  const recent = !options.query && filter === "all" ? store.listRecentFoods() : [];
  const external = options.candidates || [];
  const candidateCards = external.map((candidate) => {
    const token = candidate.token || "";
    const initials = candidate.name.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
    return `<article class="food-result food-card"><span class="food-avatar food-avatar--amber">${escapeHtml(initials)}</span><span class="food-result-main"><strong>${escapeHtml(candidate.name)}</strong><span>External candidate <span class="meta-divider">/</span> ${escapeHtml(candidate.quantityBasis)} <span class="meta-divider">/</span> ${escapeHtml(candidate.nutrients.calories ?? "Unknown")} kcal</span></span><span class="food-result-actions"><a class="text-button" href="/review?candidate=${encodeURIComponent(token)}">Review ${renderNavIcon("arrow-right", "icon--tiny")}</a></span></article>`;
  }).join("");
  const filterLink = (value: string, label: string, count?: number) => `<a class="filter-tab ${filter === value ? "is-active" : ""}" href="${value === "all" ? "/database" : `/database?filter=${value}`}"${filter === value ? ` aria-current="page"` : ""}>${label}${count === undefined ? "" : ` <span>${count}</span>`}</a>`;
  const results = `${candidateCards ? `<div class="result-group"><div class="list-heading"><div><h3>Search candidates</h3><p>External records need review before confirmation</p></div></div>${candidateCards}</div>` : ""}${recent.length ? `<div class="result-group"><div class="list-heading"><div><h3>Recent logged Foods</h3><p>Used in your latest entries</p></div><span class="list-sort">Most recent</span></div>${recent.map((food) => renderFoodCard(food)).join("")}</div>` : ""}${foods.length ? `<div class="result-group"><div class="list-heading"><div><h3>Saved Foods</h3><p>Confirmed reusable definitions</p></div></div>${foods.map((food) => renderFoodCard(food)).join("")}</div>` : ""}${meals.length ? `<div class="result-group"><div class="list-heading"><div><h3>Meals</h3><p>One assembled unit per Meal</p></div></div>${meals.map(renderMealCard).join("")}</div>` : ""}${!foods.length && !meals.length && !external.length && !recent.length ? renderEmptyState("No matching Foods", "Try a broader search or create a manual Food in Saved Foods.", "/saved-foods", "Create a Food") : ""}`;
  const content = `<section class="view-toolbar view-toolbar--stacked"><div><p class="section-kicker">Food picker</p><h2>Food Database</h2><p class="view-lede">Search is explicit so provider requests stay under your control. External records remain candidates until review.</p></div><a class="button button--secondary" href="/scan">Open Scan Food</a></section>
    <div class="database-tools"><form method="get" action="/database" class="search-field"><input name="q" value="${escapeHtml(options.query)}" placeholder="Search foods, brands, or ingredients" aria-label="Search Food Database"><button class="search-submit" type="submit">Search</button><kbd>/</kbd></form><nav class="filter-tabs" aria-label="Food filters">${filterLink("all", "All", foods.length + meals.length)}${filterLink("meals", "My Meals", meals.length)}${filterLink("favorites", "My Favorites")}${filterLink("foods", "My Foods", foods.length)}</nav></div>
    ${options.error ? `<p class="notice notice--error" role="alert">${escapeHtml(options.error)}</p>` : ""}<div class="database-layout"><section class="result-list" aria-label="Food results">${results}</section><aside class="database-aside"><div class="aside-rule"></div><h3>Sources stay visible.</h3><p>External records remain candidates until you review and confirm them. Nothing here logs silently.</p><a class="text-button" href="/scan">Open capture paths ${renderNavIcon("arrow-up-right", "icon--tiny")}</a></aside></div>`;
  return renderPage({ title: "Food Database", active: "database", content });
}

function renderSavedPage(store: Store, options: { search?: string; filter?: string; notice?: string; error?: string } = {}): string {
  const filter = options.filter || "all";
  const foods = filter === "meals" ? [] : store.listFoods({ search: options.search, filter: filter === "favorites" ? "favorites" : "foods" });
  const meals = filter === "foods" ? [] : store.listMeals({ search: options.search, favoritesOnly: filter === "favorites" });
  const filterLink = (value: string, label: string, count?: number) => `<a class="filter-tab ${filter === value ? "is-active" : ""}" href="${value === "all" ? "/saved-foods" : `/saved-foods?filter=${value}`}"${filter === value ? ` aria-current="page"` : ""}>${label}${count === undefined ? "" : ` <span>${count}</span>`}</a>`;
  const content = `<section class="view-toolbar view-toolbar--stacked"><div><p class="section-kicker">Personal library</p><h2>Saved Foods</h2><p class="view-lede">Confirmed Foods, Favorites, and one reusable unit Meals live here. Editing a reusable definition never rewrites history.</p></div><div class="toolbar-actions"><a class="button button--secondary" href="#manual-food">Create Food</a><a class="button button--primary" href="/saved-foods/meals/new">Create Meal</a></div></section>
    <div class="library-tools"><form method="get" action="/saved-foods" class="search-field"><input name="q" value="${escapeHtml(options.search)}" placeholder="Search your library" aria-label="Search Saved Foods"><button class="search-submit" type="submit">Search</button></form><nav class="filter-tabs" aria-label="Saved Food filters">${filterLink("all", "All", foods.length + meals.length)}${filterLink("meals", "My Meals", meals.length)}${filterLink("favorites", "My Favorites")}${filterLink("foods", "My Foods", foods.length)}</nav></div>
    ${options.error ? `<p class="notice notice--error" role="alert">${escapeHtml(options.error)}</p>` : ""}<section class="library-panel"><div class="food-list">${foods.map((food) => `${renderFoodCard(food)}<div class="item-actions"><a class="text-button" href="/foods/${food.id}/edit">Edit</a><form style="display:inline" method="post" action="/foods/${food.id}/delete" onsubmit="return confirm('Delete this reusable Food?')"><button class="text-button" type="submit">Delete</button></form></div>`).join("")}</div><div class="meal-list">${meals.map(renderMealCard).join("")}</div>${!foods.length && !meals.length ? renderEmptyState("Your library is empty", "Create a manual Food with calories and a declared quantity basis, or review a candidate first.", "#manual-food", "Create a Food") : ""}</section>
    <div id="manual-food" class="manual-food-panel">${createManualFoodForm()}</div>`;
  return renderPage({ title: "Saved Foods", active: "saved", content, notice: options.notice });
}

type ScanMode = "food" | "barcode" | "label";

function scanMode(value: unknown): ScanMode {
  return value === "barcode" || value === "label" ? value : "food";
}

function renderLiveBarcodePage(): string {
  return renderPage({
    title: "Scan Food",
    active: "scan",
    content: `<script src="https://unpkg.com/@zxing/browser@0.1.5"></script><section class="view-toolbar view-toolbar--stacked"><div><p class="section-kicker">Capture hub</p><h2>Scan Food</h2><p class="view-lede">Capture first. Review every proposal before it becomes part of your log.</p></div><span class="capture-status"><span class="status-dot"></span> Barcode mode</span></section><div class="scan-layout"><section class="scan-console"><nav class="scan-mode-tabs" aria-label="Scan mode"><a class="scan-mode" href="/scan">${renderNavIcon("log")}Food</a><a class="scan-mode is-active" href="/scan?mode=barcode" aria-current="page">${renderNavIcon("search")}Barcode</a><a class="scan-mode" href="/scan?mode=label">${renderNavIcon("log")}Food Label</a></nav><div class="scan-stage"><div class="scan-stage-top"><span>Capture and review</span><span>Server upload</span></div><div class="scan-frame scan-frame--barcode" aria-label="Live barcode camera preview"><video data-barcode-video autoplay muted playsinline hidden aria-label="Live barcode camera"></video><div class="barcode-camera-placeholder" data-barcode-camera-placeholder><div class="capture-placeholder"><strong>Starting camera</strong><span>Allow camera access to scan a barcode here.</span></div></div><div class="barcode-camera-overlay" aria-hidden="true"></div><span class="scan-caption" data-barcode-camera-status role="status">Requesting camera access...</span><div class="camera-frame-actions"><button class="button button--primary" type="button" data-barcode-scan disabled>Scan</button></div></div><div class="scan-controls"><p>Point the camera at a barcode, then tap Scan to capture the current frame and look up the product.</p><form id="barcode-form" method="post" action="/scan/barcode" class="capture-form"><label>Barcode<input name="barcode" inputmode="numeric" autocomplete="off" pattern="[0-9 -]{8,20}" placeholder="UPC, EAN, or GTIN" aria-label="Barcode" data-barcode-input required></label><button class="button button--secondary" type="submit">Look up barcode</button></form></div></div></section><aside class="scan-side-panel"><div class="aside-rule"></div><h3>Evidence first, estimates second.</h3><p>Capture a clear code. The external record remains a candidate until you review it.</p></aside></div>`,
  });
}

function renderLiveLabelPage(): string {
  return renderPage({
    title: "Scan Food",
    active: "scan",
    content: `<section class="view-toolbar view-toolbar--stacked"><div><p class="section-kicker">Capture hub</p><h2>Scan Food</h2><p class="view-lede">Capture first. Review every proposal before it becomes part of your log.</p></div><span class="capture-status"><span class="status-dot"></span> Food Label mode</span></section><div class="scan-layout"><section class="scan-console"><nav class="scan-mode-tabs" aria-label="Scan mode"><a class="scan-mode" href="/scan">${renderNavIcon("log")}Food</a><a class="scan-mode" href="/scan?mode=barcode">${renderNavIcon("search")}Barcode</a><a class="scan-mode is-active" href="/scan?mode=label" aria-current="page">${renderNavIcon("log")}Food Label</a></nav><div class="scan-stage"><div class="scan-stage-top"><span>Capture and review</span><span>Server upload</span></div><div class="scan-frame scan-frame--label" aria-label="Live nutrition label camera preview"><video data-label-video autoplay muted playsinline hidden aria-label="Live nutrition label camera"></video><div class="camera-placeholder" data-label-camera-placeholder><div class="capture-placeholder"><strong>Starting camera</strong><span>Allow camera access to photograph the full nutrition label.</span></div></div><div class="camera-overlay" aria-hidden="true"></div><span class="scan-caption" data-label-camera-status role="status">Requesting camera access...</span><div class="camera-frame-actions"><button class="button button--secondary" type="button" data-label-start>Start camera</button><button class="button button--primary" type="button" data-label-capture disabled>Take label photo</button></div></div><div class="scan-controls"><p>Camera capture starts when this mode opens. Review every extracted value before confirmation.</p><form method="post" action="/scan/label" id="label-form" enctype="multipart/form-data" class="capture-form"><label class="button button--secondary">Use camera image<input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif" capture="environment" data-label-file required></label><button class="button button--secondary" type="submit">Read label</button></form></div></div></section><aside class="scan-side-panel"><div class="aside-rule"></div><h3>Evidence first, estimates second.</h3><p>Visible values can be proposed. Unknown values are never invented. Every result stays editable until you confirm it.</p></aside></div>`,
  });
}

function renderLabelCameraPage(): string {
  return renderPage({
    title: "Scan Food",
    active: "scan",
    content: `<section class="view-toolbar view-toolbar--stacked"><div><p class="section-kicker">Capture hub</p><h2>Scan Food</h2><p class="view-lede">Capture first. Review every proposal before it becomes part of your log.</p></div><span class="capture-status"><span class="status-dot"></span> Food Label mode</span></section><div class="scan-layout"><section class="scan-console"><nav class="scan-mode-tabs" aria-label="Scan mode"><a class="scan-mode" href="/scan">${renderNavIcon("log")}Food</a><a class="scan-mode" href="/scan?mode=barcode">${renderNavIcon("search")}Barcode</a><a class="scan-mode is-active" href="/scan?mode=label" aria-current="page">${renderNavIcon("log")}Food Label</a></nav><div class="scan-stage"><div class="scan-stage-top"><span>Capture and review</span><span>Server upload</span></div><div class="scan-frame scan-frame--label" aria-label="Live nutrition label camera preview"><video data-label-video autoplay muted playsinline hidden aria-label="Live nutrition label camera"></video><div class="camera-placeholder" data-label-camera-placeholder><div class="capture-placeholder"><strong>Starting camera</strong><span>Allow camera access to photograph the full nutrition label.</span></div></div><div class="camera-overlay" aria-hidden="true"></div><span class="scan-caption" data-label-camera-status role="status">Requesting camera access...</span><div class="camera-frame-actions"><button class="button button--primary" type="button" data-label-capture disabled>Read Label</button></div></div><div class="scan-controls"><p>Frame the full label, then tap Read Label to capture it and extract the visible product information.</p><form method="post" action="/scan/label" id="label-form" enctype="multipart/form-data" class="capture-form"><input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif" data-label-file aria-label="Captured label image" required hidden></form></div></div></section><aside class="scan-side-panel"><div class="aside-rule"></div><h3>Evidence first, estimates second.</h3><p>OCR values remain candidates until you review and confirm them.</p></aside></div>`,
  });
}

function renderScanModePage(mode: ScanMode): string {
  const tab = (value: ScanMode, label: string, iconName: string) => `<a class="scan-mode ${mode === value ? "is-active" : ""}" href="/scan${value === "food" ? "" : `?mode=${value}`}"${mode === value ? ` aria-current="page"` : ""}>${renderNavIcon(iconName)}${label}</a>`;
  if (mode === "food") return renderScanPage();
  if (mode === "barcode") return renderLiveBarcodePage();
  if (mode === "label") return renderLabelCameraPage();
  const form = mode === "barcode"
    ? `<script src="https://unpkg.com/@zxing/browser@0.1.5"></script><div class="scan-frame scan-frame--barcode" aria-label="Live barcode camera preview"><video data-barcode-video autoplay muted playsinline hidden aria-label="Live barcode camera"></video><div class="barcode-camera-placeholder" data-barcode-camera-placeholder><div class="capture-placeholder"><strong>Starting camera</strong><span>Allow camera access to scan a barcode here.</span></div></div><div class="barcode-camera-overlay" aria-hidden="true"></div><span class="scan-caption" data-barcode-camera-status role="status">Requesting camera access...</span></div><div class="scan-controls"><p>Camera scanning starts when this mode opens. Manual entry remains available if camera access or live detection is unavailable.</p><form id="barcode-form" method="post" action="/scan/barcode" class="capture-form"><button class="button button--secondary" type="button" data-barcode-start>Start camera</button><label class="button button--secondary">Use camera image<input type="file" accept="image/*" capture="environment" data-barcode-camera></label><label>Barcode<input name="barcode" inputmode="numeric" autocomplete="off" pattern="[0-9 -]{8,20}" placeholder="UPC, EAN, or GTIN" aria-label="Barcode" data-barcode-input required></label><button class="button button--primary" type="submit">Look up barcode</button></form></div>`
    : `<div class="scan-frame scan-frame--label" aria-label="Food Label image upload"><div class="capture-placeholder"><strong>Nutrition label</strong><span>Frame the serving and nutrient values clearly.</span></div><span class="scan-caption">Missing values remain unknown until you edit them</span></div><div class="scan-controls"><p>Extraction is a candidate only. Review the product name, declared basis, calories, and every visible nutrient.</p><form method="post" action="/scan/label" enctype="multipart/form-data" class="capture-form"><label class="button button--primary">Choose label image<input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif" capture="environment" required></label><button class="button button--secondary" type="submit">Read label</button></form></div>`;
  const titles = { food: "Food image", barcode: "Barcode", label: "Food Label" };
  return renderPage({
    title: "Scan Food",
    active: "scan",
    content: `<section class="view-toolbar view-toolbar--stacked"><div><p class="section-kicker">Capture hub</p><h2>Scan Food</h2><p class="view-lede">Capture first. Review every proposal before it becomes part of your log.</p></div><span class="capture-status"><span class="status-dot"></span> ${titles[mode]} mode</span></section><div class="scan-layout"><section class="scan-console"><nav class="scan-mode-tabs" aria-label="Scan mode">${tab("food", "Food", "log")}${tab("barcode", "Barcode", "search")}${tab("label", "Food Label", "log")}</nav><div class="scan-stage"><div class="scan-stage-top"><span>Capture and review</span><span>Server upload</span></div>${form}</div></section><aside class="scan-side-panel"><div class="aside-rule"></div><h3>Evidence first, estimates second.</h3><p>Visible values can be proposed. Unknown values are never invented. Every result stays editable until you confirm it.</p></aside></div>`,
  });
}

function renderScanPage(message = "", retry?: string): string {
  const content = `<section class="view-toolbar view-toolbar--stacked"><div><p class="section-kicker">Capture hub</p><h2>Scan Food</h2><p class="view-lede">Capture first. Review every proposal before it becomes part of your log.</p></div><span class="capture-status"><span class="status-dot"></span> Camera-ready workflow</span></section><div class="scan-layout"><section class="scan-console"><nav class="scan-mode-tabs" aria-label="Scan mode"><a class="scan-mode is-active" href="/scan">${renderNavIcon("log")}Food</a><a class="scan-mode" href="/scan?mode=barcode">${renderNavIcon("search")}Barcode</a><a class="scan-mode" href="/scan?mode=label">${renderNavIcon("log")}Food Label</a></nav><div class="scan-stage"><div class="scan-stage-top"><span>Capture and review</span><span>Server upload</span></div><div class="scan-frame scan-frame--food" aria-label="Food image upload preview"><span class="frame-corner frame-corner--tl"></span><span class="frame-corner frame-corner--tr"></span><span class="frame-corner frame-corner--bl"></span><span class="frame-corner frame-corner--br"></span><div class="capture-placeholder"><div class="capture-crosshair"></div><strong>Food image</strong><span>Choose a well-lit plate or meal photo</span></div><span class="scan-caption">Nothing is persisted until review</span></div><div class="scan-controls"><p>AI output remains a candidate. Every identified ingredient can be corrected or removed before confirmation.</p><form method="post" action="/scan/food" enctype="multipart/form-data" class="capture-form"><label class="button button--primary">Choose image<input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif" required></label><button class="button button--secondary" type="submit">Analyze Food</button></form></div></div>${message ? `<p class="notice notice--error scan-message" role="alert">${escapeHtml(message)}</p>` : ""}${retry ? `<form method="post" action="${escapeHtml(retry)}" class="retry-form"><button class="button button--secondary" type="submit">Retry capture</button></form>` : ""}<div class="scan-alt-paths"><div><h3>Barcode lookup</h3><p>Use a package barcode when a label is easier to identify than a photo.</p><form method="post" action="/scan/barcode" class="form-row"><input name="barcode" inputmode="numeric" placeholder="UPC, EAN, or GTIN" aria-label="Barcode"><button class="button button--secondary" type="submit">Look up</button></form></div><div><h3>Nutrition label</h3><p>Upload a label and review every extracted field before saving.</p><form method="post" action="/scan/label" enctype="multipart/form-data" class="form-row"><label class="button button--secondary">Choose label<input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif" required></label><button class="button button--secondary" type="submit">Read label</button></form></div></div></section><aside class="scan-side-panel"><div class="aside-rule"></div><h3>Evidence first, estimates second.</h3><p>Visible ingredients can be proposed. Hidden ingredients are never invented. Every estimate stays editable until you confirm it.</p><div class="scan-side-list"><div><span class="side-index">01</span><span>Capture the real food</span></div><div><span class="side-index">02</span><span>Review every proposal</span></div><div><span class="side-index">03</span><span>Confirm what you trust</span></div></div></aside></div>`;
  return renderPage({ title: "Scan Food", active: "scan", content });
}

function renderTargetPage(store: Store, config: AppConfig, proposal?: { token: string; estimate: ReturnType<typeof estimateNutrition> }, error = ""): string {
  const active = store.getActiveTarget();
  const labelReference = { calories: 2000, protein: 50, carbohydrates: 275, fat: 78, fiber: 28, addedSugar: 50, saturatedFat: 20, sodium: 2300 };
  const content = `<section class="page-heading"><div><p class="eyebrow">Daily Targets</p><h1>References under your control</h1><p>Targets are optional. General estimates are for adults 19+ and are informational, not medical advice. No progress evaluation appears until you confirm a target.</p></div></section>${error ? `<p class="notice notice--error" role="alert">${escapeHtml(error)}</p>` : ""}${active ? `<section class="form-panel"><p class="eyebrow">Active target</p><h2>${escapeHtml(active.plan || active.kind)}</h2><p class="lead">${active.calories === null ? "No calorie target" : `${Math.round(active.calories)} kcal/day`}</p>${renderReferenceTable(active.references)}${renderReferenceControls(active)}<form method="post" action="/targets/${active.id}/disable"><button class="button button--secondary" type="submit">Disable target</button></form></section>` : `<p class="notice notice--warning">No target is active. Daily summaries show intake and missing-data warnings without judging progress.</p>`}
    <section class="form-panel" style="margin-top:22px"><p class="eyebrow">Manual target</p><h2>Set a target yourself</h2><form method="post" action="/targets/manual" class="stack-form"><div class="form-grid"><label>Calories / day <input name="calories" inputmode="decimal"></label><label>Protein minimum (g) <input name="proteinMin" inputmode="decimal"></label><label>Protein maximum (g) <input name="proteinMax" inputmode="decimal"></label><label>Carbohydrates minimum (g) <input name="carbohydratesMin" inputmode="decimal"></label><label>Carbohydrates maximum (g) <input name="carbohydratesMax" inputmode="decimal"></label><label>Total fat minimum (g) <input name="fatMin" inputmode="decimal"></label><label>Total fat maximum (g) <input name="fatMax" inputmode="decimal"></label><label>Fiber minimum (g) <input name="fiberMin" inputmode="decimal"></label><label>Saturated fat upper reference (g) <input name="saturatedFatMax" inputmode="decimal"></label><label>Sodium upper reference (mg) <input name="sodiumMax" inputmode="decimal"></label><label>Added sugar label context (g) <input name="addedSugarMax" value="50" inputmode="decimal"></label></div><button class="button" type="submit">Confirm manual target</button></form></section>
    <section class="form-panel" style="margin-top:22px"><p class="eyebrow">FDA Label reference</p><h2>Comparison context only</h2><p class="muted">These standardized 2,000-kcal label values are never a personal target.</p><ul class="reference-list">${Object.entries(labelReference).map(([key, value]) => `<li><strong>${escapeHtml(key)}</strong><span>${escapeHtml(value)} ${key === "sodium" ? "mg" : key === "calories" ? "kcal" : "g"}</span></li>`).join("")}</ul></section>
    <section class="form-panel" style="margin-top:22px"><p class="eyebrow">Optional estimate</p><h2>Generate a proposal</h2><form method="post" action="/targets/estimate" class="stack-form"><div class="form-grid"><label>Age (19+) <input name="age" type="number" min="19" required></label><label>Equation sex category <select name="sex"><option value="female">Female</option><option value="male">Male</option></select></label><label>Height (cm) <input name="heightCm" type="number" step=".1" required></label><label>Weight (kg) <input name="weightKg" type="number" step=".1" required></label><label>Activity <select name="activity"><option>Inactive</option><option>Low active</option><option>Active</option><option>Very active</option></select></label><label>Plan <select name="plan"><option>Maintain</option><option>Lose</option><option>Gain</option></select></label><label>Target weight (kg) <input name="targetWeightKg" type="number" step=".1"></label><label>Target date <input name="targetDate" type="date"></label></div><button class="button" type="submit">Generate proposal</button></form></section>
    ${proposal ? `<section class="form-panel" style="margin-top:22px"><p class="eyebrow">Proposal / not active</p><h2>${escapeHtml(proposal.estimate.plan)} target: ${Math.round(proposal.estimate.targetCalories)} kcal/day</h2><p class="muted">Estimated maintenance: ${Math.round(proposal.estimate.maintenanceCalories)} kcal/day. Review the assumptions before confirmation.</p>${proposal.estimate.warnings.map((warning) => `<p class="notice notice--warning">${escapeHtml(warning)}</p>`).join("")}${renderReferenceTable(proposal.estimate.references)}<form method="post" action="/targets/proposals/${encodeURIComponent(proposal.token)}/confirm"><button class="button" type="submit">Confirm this target</button></form></section>` : ""}
    <section class="form-panel" style="margin-top:22px"><p class="eyebrow">Timezone</p><h2>Local calendar</h2><form method="post" action="/settings/timezone" class="form-row"><input name="timezone" value="${escapeHtml(store.getTimezone(config.timezone))}" placeholder="America/New_York" required><button class="button button--secondary" type="submit">Save timezone</button></form><p class="muted">The saved timezone is authoritative; browser timezone is only a first-use seed.</p></section>`;
  return renderPage({ title: "Daily Targets", active: "targets", content });
}

function renderMealEditor(store: Store, meal: MealRecord, error = ""): string {
  const foods = store.listFoods();
  const content = `<section class="page-heading"><div><p class="eyebrow">Saved Foods / Meal</p><h1>${escapeHtml(meal.name)}</h1><p>One saved Meal is one assembled unit. There is no yield or servings-produced field.</p></div></section>${error ? `<p class="notice notice--error" role="alert">${escapeHtml(error)}</p>` : ""}<section class="form-panel"><h2>Ingredients</h2>${meal.missingNutrients.length ? `<p class="notice notice--warning">Some optional nutrients are unknown in the ingredient list. Meal totals use zero for arithmetic but keep the missing-data warning.</p>` : ""}${meal.ingredients.length ? meal.ingredients.map((ingredient) => `<article class="ingredient-row"><div><h3>${escapeHtml(ingredient.name)}</h3><p class="muted">${escapeHtml(ingredient.quantity.display)} ${escapeHtml(ingredient.quantity.unit)} / ${escapeHtml(String(Math.round(ingredient.nutrients.calories ?? 0)))} kcal per basis</p></div><div class="form-row"><form method="post" action="/meal-ingredients/${ingredient.id}"><input name="quantity" value="${escapeHtml(ingredient.quantity.display)}" aria-label="Quantity for ${escapeHtml(ingredient.name)}"><input type="hidden" name="unit" value="${escapeHtml(ingredient.quantity.unit)}"><button class="button button--quiet" type="submit">Update</button></form><form method="post" action="/meal-ingredients/${ingredient.id}/replace"><select name="foodId" aria-label="Replace ${escapeHtml(ingredient.name)}">${foods.map((food) => `<option value="${food.id}" ${food.id === ingredient.foodId ? "selected" : ""}>${escapeHtml(food.name)}</option>`).join("")}</select><input name="quantity" value="${escapeHtml(ingredient.quantity.display)}"><input type="hidden" name="unit" value="${escapeHtml(ingredient.quantity.unit)}"><button class="button button--quiet" type="submit">Replace</button></form><form method="post" action="/meal-ingredients/${ingredient.id}/delete"><button class="button button--quiet" type="submit">Remove</button></form></div></article>`).join("") : `<p class="muted">Add confirmed Foods below. Candidates cannot enter a Meal until confirmation.</p>`}<h2 style="margin-top:28px">Add Ingredient</h2><form method="post" action="/meals/${meal.id}/ingredients" class="form-row"><select name="foodId" required><option value="">Choose a confirmed Food</option>${foods.map((food) => `<option value="${food.id}">${escapeHtml(food.name)}</option>`).join("")}</select><input name="quantity" value="1" placeholder="1/2" required><input name="unit" placeholder="unit"><button class="button" type="submit">Add Ingredient</button></form><hr><p class="lead">Meal nutrition: ${Math.round(meal.nutrients.calories ?? 0)} kcal</p>${renderNutritionList(meal.nutrients)}<div class="form-row"><form method="post" action="/meals/${meal.id}/favorite"><button class="button button--secondary" type="submit">${meal.favorite ? "Favorite" : "Favorite Meal"}</button></form><form method="post" action="/meals/${meal.id}/delete" onsubmit="return confirm('Delete this Meal?')"><button class="button button--secondary" type="submit">Delete Meal</button></form></div><form method="post" action="/meals/${meal.id}/image" enctype="multipart/form-data" class="stack-form"><label>Retained Meal image <input type="file" name="image" accept="image/jpeg,image/png,image/webp,image/gif"></label><button class="button button--secondary" type="submit">Attach image</button></form></section>`;
  return renderPage({ title: meal.name, active: "saved", content });
}

function renderFoodEntryEditor(entry: FoodEntryRecord, timezone: string): string {
  const date = localDateFor(entry.loggedAtUtc, timezone);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(entry.loggedAtUtc));
  const profile = profileFromEntry(entry);
  const nutrientFields = ["calories", "protein", "carbohydrates", "fat", "fiber", "addedSugar", "sugar", "saturatedFat", "sodium"].map((key) => `<label>${escapeHtml(key)} <input name="${key}" value="${escapeHtml((profile.nutrients as unknown as Record<string, unknown>)[key])}" inputmode="decimal"></label>`).join("");
  return renderPage({ title: `Edit ${entry.title}`, active: "log", content: `<section class="form-panel"><p class="eyebrow">Historical snapshot</p><h1>Edit Food entry</h1><p class="muted">Change this entry only. The reusable Food and other entries remain unchanged.</p>${renderNutritionList(entry.snapshot.nutrients)}<form method="post" action="/entries/${entry.id}" class="stack-form"><label>Date <input name="date" type="date" value="${date}" required></label><label>Time <input name="time" type="time" value="${time}" required></label><label>Quantity <input name="quantity" value="${escapeHtml(entry.snapshot.quantity.display)}" required></label><label>Meal tag <select name="mealTag"><option value="">No tag</option>${["Breakfast", "Lunch", "Dinner", "Snack"].map((tag) => `<option ${entry.mealTag === tag ? "selected" : ""}>${tag}</option>`).join("")}</select><details class="form-panel"><summary>Edit Food details for this entry</summary><div class="stack-form"><label>Food name <input name="name" value="${escapeHtml(profile.name)}"></label><label>Declared quantity basis <input name="quantityBasis" value="${escapeHtml(profile.quantityBasis)}"></label><div class="form-grid">${nutrientFields}</div><label><input type="checkbox" name="editDetails" value="1"> Apply Food detail changes to this entry</label></div></details><button class="button" type="submit">Save Food entry</button></form></section>` });
}

function renderDataPage(store: Store, notice = ""): string {
  const images = store.listImages();
  const content = `<section class="page-heading"><div><p class="eyebrow">Local instance</p><h1>Your data</h1><p>Exports include structured records and retained Food images. Credentials, prompts, raw provider responses, and environment values are never included.</p></div></section><section class="form-panel"><h2>Export</h2><p class="muted">Exports are written under DATA_DIR/exports in a restorable directory format.</p><form method="post" action="/settings/data/export"><button class="button" type="submit">Export data</button></form></section><section class="form-panel" style="margin-top:22px"><h2>Retained Food images</h2>${images.length ? `<div class="food-list">${images.map((image) => `<article class="food-card"><div><h3>${escapeHtml(image.originalName)}</h3><p class="muted">${escapeHtml(image.mimeType)} / ${escapeHtml(image.byteSize)} bytes</p></div><form method="post" action="/images/${image.id}/delete"><button class="button button--secondary" type="submit">Delete image</button></form></article>`).join("")}</div>` : `<p class="muted">No retained images.</p>`}</section><section class="form-panel" style="margin-top:22px"><h2>Delete all data</h2><p class="muted">This removes domain records, retained images, and exports. Reusable-item deletion elsewhere never removes historical snapshots.</p><form method="post" action="/settings/data/delete-all" class="form-row"><input name="confirmation" placeholder="Type DELETE to confirm" required><button class="button button--secondary" type="submit">Delete all</button></form></section>`;
  return renderPage({ title: "Your data", active: "log", content, notice });
}

function renderReferenceControls(target: { id: number; references: NutrientReferences }): string {
  return `<div class="reference-controls"><h3>Edit or disable references</h3>${Object.entries(target.references).filter(([, reference]) => reference).map(([key, reference]) => `<form method="post" action="/targets/${target.id}/reference" class="form-row"><input type="hidden" name="nutrient" value="${escapeHtml(key)}"><span class="muted">${escapeHtml(key === "proteinAdequacy" ? "Protein adequacy" : key)}</span><input name="min" value="${escapeHtml(reference?.min)}" placeholder="min"><input name="max" value="${escapeHtml(reference?.max)}" placeholder="max"><input name="value" value="${escapeHtml(reference?.value)}" placeholder="value"><button class="button button--quiet" name="action" value="enable" type="submit">Save</button><button class="button button--quiet" name="action" value="disable" type="submit">Disable</button></form>`).join("")}</div>`;
}

function renderAnalysis(token: string, analysis: FoodImageAnalysis): string {
  return renderPage({ title: "Food image review", active: "scan", content: `<section class="review-panel"><p class="eyebrow">Food image candidate</p><h1>Review identified ingredients</h1><p class="muted">No ingredient is persisted from this proposal. Choose matches, edit portions, or remove ingredients before confirming.</p>${analysis.warnings.map((warning) => `<p class="notice notice--warning">${escapeHtml(warning)}</p>`).join("")}<div class="food-list">${analysis.ingredients.map((ingredient, index) => `<article class="ingredient-row"><div><h3>${escapeHtml(ingredient.name)}</h3><p class="muted">Estimated ${escapeHtml(ingredient.quantity)} ${escapeHtml(ingredient.unit)}${ingredient.confidence ? ` / ${escapeHtml(ingredient.confidence)} confidence` : ""}</p>${ingredient.matches?.length === 1 ? `<p class="muted">One match selected for review</p>` : ingredient.matches && ingredient.matches.length > 1 ? `<form method="post" action="/scan/food/${encodeURIComponent(token)}/ingredient/${index}/match" class="form-row"><select name="matchIndex" aria-label="Choose a match for ${escapeHtml(ingredient.name)}">${ingredient.matches.map((match, matchIndex) => `<option value="${matchIndex}">${escapeHtml(match.name)}</option>`).join("")}</select><button class="button button--quiet" type="submit">Use match</button></form>` : `<p class="notice notice--warning">No match. Create a manual Food with calories before confirmation.</p><a class="button button--quiet" href="/scan/food/${encodeURIComponent(token)}/ingredient/${index}/manual">Create manual Food draft</a>`}</div><div class="form-row"><a class="button button--quiet" href="/scan/food/${encodeURIComponent(token)}/ingredient/${index}/edit">Edit</a><form method="post" action="/scan/food/${encodeURIComponent(token)}/ingredient/${index}/edit-ai"><input type="hidden" name="instruction" value="Review and improve this ingredient proposal"><button class="button button--quiet" type="submit">Edit with AI</button></form><form method="post" action="/scan/food/${encodeURIComponent(token)}/ingredient/${index}/delete"><button class="button button--quiet" type="submit">Delete</button></form></div></article>`).join("")}</div><div class="form-row"><form method="post" action="/scan/food/${encodeURIComponent(token)}/confirm"><button class="button" type="submit">Confirm proposal</button></form><form method="post" action="/scan/food/${encodeURIComponent(token)}/edit-ai"><input name="instruction" placeholder="Ask AI for a proposed edit" required><button class="button button--secondary" type="submit">Edit entire meal with AI</button></form></div></section>` });
}

function renderAiProposalPage(token: string, message: string, ingredients: IngredientProposal[]): string {
  return renderPage({ title: "AI edit proposal", active: "scan", content: `<section class="review-panel"><p class="eyebrow">Proposal only</p><h1>Review the suggested edit</h1><p>${escapeHtml(message)}</p><pre>${escapeHtml(JSON.stringify(ingredients, null, 2))}</pre><p class="notice notice--warning">No change has been applied. Confirm only after reviewing every proposed ingredient.</p><div class="form-row"><form method="post" action="/scan/food/proposals/${encodeURIComponent(token)}/confirm"><button class="button" type="submit">Confirm proposal</button></form><form method="post" action="/scan/food/proposals/${encodeURIComponent(token)}/dismiss"><button class="button button--secondary" type="submit">Dismiss proposal</button></form></div></section>` });
}

export function createApplication(options: ApplicationOptions = {}): Application {
  const baseConfig = loadConfig();
  const config: AppConfig = { ...baseConfig, ...options.config, dataDir: options.dataDir || options.config?.dataDir || baseConfig.dataDir };
  const ownsConnection = !options.connection && !options.store;
  const connection = options.connection || openDatabase(config.dataDir);
  if (options.migrate === true && ownsConnection) applyMigrations(connection.sqlite);
  const store = options.store || new Store(connection);
  store.ensureUser(config.timezone);
  const imageStorage = options.imageStorage || new ImageStorage(config.dataDir);
  const external = new OpenFoodFactsAdapter({ userAgent: config.openFoodFactsUserAgent });
  const barcodeAdapter = options.barcodeAdapter || external;
  const searchAdapter = options.searchAdapter || external;
  const aiAdapter = options.aiAdapter ?? (config.openAiApiKey ? new OpenAiFoodAdapter({ apiKey: config.openAiApiKey, model: config.openAiModel }) : undefined);
  const labelAdapter = options.labelAdapter ?? (config.openAiApiKey ? new OpenAiLabelAdapter({ apiKey: config.openAiApiKey, model: config.openAiModel }) : undefined);
  const logger = options.logger || defaultLogger;
  const candidates = new Map<string, StoredCandidate>();
  const analyses = new Map<string, { analysis: FoodImageAnalysis; buffer?: Buffer; mimeType?: string; originalName?: string }>();
  const aiProposals = new Map<string, { analysisToken: string; index?: number; ingredients: IngredientProposal[]; message: string }>();
  const proposals = new Map<string, ReturnType<typeof estimateNutrition>>();
  const undoFoodEntries = new Map<number, FoodEntryRecord>();
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxImageBytes } });
  const app = express();
  app.use(express.urlencoded({ extended: true }));
  app.use(express.json());

  const send = (response: Response, html: string, status = 200) => response.status(status).type("html").send(html);
  const redirect = (response: Response, location: string) => response.redirect(303, location);
  const candidateToken = (candidate: StoredCandidate): string => {
    const token = cryptoToken();
    candidates.set(token, { ...candidate, token });
    return token;
  };

  app.get("/", (request, response) => redirect(response, `/log${request.query.date ? `?date=${encodeURIComponent(text(request.query.date))}` : ""}`));
  app.get("/health", (_request, response) => {
    try {
      connection.sqlite.prepare("SELECT 1").get();
      response.json({ status: "ok", database: "ok" });
    } catch {
      response.status(503).json({ status: "error", database: "unavailable" });
    }
  });
  app.get("/api/health", (_request, response) => response.redirect(308, "/health"));

  app.get("/log", (request, response) => {
    const timezone = store.getTimezone(config.timezone);
    const date = /^\d{4}-\d{2}-\d{2}$/.test(text(request.query.date)) ? text(request.query.date) : currentLocalDate(timezone);
    send(response, renderLogPage(store, config, date, text(request.query.notice), text(request.query.undo) || undefined));
  });

  app.get("/database", async (request, response) => {
    const query = text(request.query.q).trim();
    const filter = text(request.query.filter, "all");
    if (!query) return send(response, renderDatabasePage(store, config, { filter }));
    try {
      const remote = await searchAdapter.search(query);
      const candidatesWithTokens = remote.map((candidate) => ({ ...candidate, token: candidateToken(candidate) }));
      return send(response, renderDatabasePage(store, config, { query, filter, candidates: candidatesWithTokens }));
    } catch (error) {
      const failure = error instanceof ProviderFailure ? error : new ProviderFailure("unexpected", "Food search failed.");
      logger.warn("food_search_failed", { operation: "food_search", provider: "configured", failure: failure.kind, retryable: failure.retryable });
      return send(response, renderDatabasePage(store, config, { query, filter, error: `${providerFailureTitle(failure.kind, "Food search")}: ${failure.message} ${providerFailureGuidance(failure)}` }));
    }
  });

  app.get("/saved-foods", (request, response) => send(response, renderSavedPage(store, { search: text(request.query.q), filter: text(request.query.filter, "all"), notice: text(request.query.notice) })));
  app.post("/foods", (request, response) => {
    try {
      const profile = parseProfileForm(request.body as Record<string, unknown>);
      store.createFood({ ...profile, source: "manual", quantityBasis: profile.quantityBasis, nutrients: profile.nutrients });
      return redirect(response, "/saved-foods?notice=Food%20created");
    } catch (error) {
      return send(response, renderSavedPage(store, { error: error instanceof Error ? error.message : "Food could not be created." }), 400);
    }
  });
  app.get("/foods/:id/edit", (request, response) => {
    const food = store.getFood(Number(request.params.id));
    if (!food) return send(response, renderErrorPage("Food not found", "That reusable Food no longer exists.", "log"), 404);
    return send(response, renderPage({ title: `Edit ${food.name}`, active: "saved", content: createManualFoodForm(food) }));
  });
  app.post("/foods/:id", (request, response) => {
    try {
      const profile = parseProfileForm(request.body as Record<string, unknown>);
      store.updateFood(Number(request.params.id), { ...profile, source: "manual", nutrients: profile.nutrients });
      return redirect(response, "/saved-foods?notice=Food%20updated");
    } catch (error) {
      return send(response, renderErrorPage("Food could not be updated", error instanceof Error ? error.message : "Invalid Food.", "log"), 400);
    }
  });
  app.post("/foods/:id/delete", (request, response) => { store.deleteFood(Number(request.params.id)); return redirect(response, "/saved-foods?notice=Food%20deleted"); });
  app.post("/foods/:id/favorite", (request, response) => { store.favoriteFood(Number(request.params.id)); return redirect(response, "/saved-foods?notice=Food%20saved%20as%20a%20Favorite"); });
  app.post("/foods/:id/unfavorite", (request, response) => { store.unfavoriteFood(Number(request.params.id)); return redirect(response, "/saved-foods?notice=Favorite%20removed"); });
  app.post("/foods/:id/image", upload.single("image"), async (request, response) => {
    const food = store.getFood(Number(request.params.id));
    try {
      if (!food || !request.file) throw new Error("Food and image are required.");
      const stored = await imageStorage.save({ buffer: request.file.buffer, mimeType: request.file.mimetype, originalName: request.file.originalname }, config.maxImageBytes);
      try { store.addImageRecord({ ...stored, foodId: food.id, mealId: null }); } catch (error) { await imageStorage.delete(stored.managedName); throw error; }
      return redirect(response, `/foods/${food.id}/edit`);
    } catch (error) { return send(response, renderErrorPage("Image could not be retained", error instanceof Error ? error.message : "Invalid image.", "saved"), 400); }
  });

  app.get("/review", (request, response) => {
    const token = text(request.query.candidate);
    if (token) {
      const candidate = candidates.get(token);
      if (!candidate) return send(response, renderErrorPage("Candidate expired", "Run the lookup again so the result can be reviewed.", "database"), 404);
      return send(response, renderPage({ title: candidate.name, active: "database", content: renderReviewSurface({ title: candidate.name, profile: candidateReviewProfile(candidate), source: candidate.source, warnings: candidate.warnings, timezone: store.getTimezone(config.timezone), token }) }));
    }
    const foodId = numberOrNull(request.query.foodId);
    if (foodId !== null) {
      const food = store.getFood(foodId);
      if (!food) return send(response, renderErrorPage("Food not found", "That Food is no longer available.", "database"), 404);
      return send(response, renderPage({ title: food.name, active: "database", content: renderReviewSurface({ title: food.name, profile: profileFromFood(food), source: "Confirmed Food", timezone: store.getTimezone(config.timezone), foodId }) }));
    }
    const mealId = numberOrNull(request.query.mealId);
    if (mealId !== null) {
      const meal = store.getMeal(mealId);
      if (!meal) return send(response, renderErrorPage("Meal not found", "That Meal is no longer available.", "saved"), 404);
      return send(response, renderPage({ title: meal.name, active: "saved", content: renderReviewSurface({ title: meal.name, profile: profileFromMeal(meal), source: "Saved Meal", timezone: store.getTimezone(config.timezone), mealId }) }));
    }
    return redirect(response, "/database");
  });

  function addEntryResponse(request: Request, response: Response, source: { foodId?: number; mealId?: number; candidate?: StoredCandidate }): void {
    try {
      const date = text(request.body.date, currentLocalDate(store.getTimezone(config.timezone)));
      const time = text(request.body.time, localTime(store.getTimezone(config.timezone)));
      const loggedAtUtc = utcFromLocal(date, time, store.getTimezone(config.timezone));
      const quantity = text(request.body.quantity, "1");
      const mealTag = text(request.body.mealTag) as MealTag | "";
      const entry = source.candidate
        ? store.addFoodEntry({ profile: candidateProfileFromRequest(source.candidate, request.body as Record<string, unknown>), quantity, loggedAtUtc, mealTag: mealTag || null })
        : source.foodId !== undefined
          ? store.addFoodEntry({ foodId: source.foodId, quantity, loggedAtUtc, mealTag: mealTag || null })
          : store.addMealEntry({ mealId: source.mealId, quantity, loggedAtUtc, mealTag: mealTag || null });
      redirect(response, `/log?date=${encodeURIComponent(date)}&notice=${encodeURIComponent(`${entry.title} added to the log`)}`);
    } catch (error) {
      send(response, renderErrorPage("Could not add to log", error instanceof Error ? error.message : "Review the quantity and required values.", "log"), 400);
    }
  }

  app.post("/review/candidate/:token/add", (request, response) => { const candidate = candidates.get(request.params.token); if (!candidate) return send(response, renderErrorPage("Candidate expired", "Run the lookup again.", "scan"), 404); return addEntryResponse(request, response, { candidate }); });
  app.post("/review/food/:id/add", (request, response) => addEntryResponse(request, response, { foodId: Number(request.params.id) }));
  app.post("/review/meal/:id/add", (request, response) => addEntryResponse(request, response, { mealId: Number(request.params.id) }));
  app.post("/review/candidate/:token/save", async (request, response) => {
    let stored: Awaited<ReturnType<ImageStorage["save"]>> | undefined;
    try {
      const candidate = candidates.get(request.params.token);
      if (!candidate) return send(response, renderErrorPage("Candidate expired", "Run the lookup again.", "scan"), 404);
      if (candidate.buffer && candidate.mimeType) {
        stored = await imageStorage.save({ buffer: candidate.buffer, mimeType: candidate.mimeType, originalName: candidate.originalName || "food-image" }, config.maxImageBytes);
      }
      const profile = { ...candidateProfileFromRequest(candidate, request.body as Record<string, unknown>), source: candidate.source };
      const food = stored ? store.createFoodWithImage(profile, stored) : store.createFood(profile);
      return redirect(response, `/saved-foods?notice=${encodeURIComponent(`${food.name} saved to Saved Foods`)}`);
    } catch (error) {
      if (stored) await imageStorage.delete(stored.managedName).catch(() => undefined);
      return send(response, renderErrorPage("Candidate needs correction", error instanceof Error ? error.message : "Calories are required.", "database"), 400);
    }
  });
  app.post("/review/food/:id/favorite", (request, response) => { store.favoriteFood(Number(request.params.id)); return redirect(response, "/saved-foods?notice=Food%20saved%20as%20a%20Favorite"); });
  app.post("/review/meal/:id/favorite", (request, response) => { store.favoriteMeal(Number(request.params.id)); return redirect(response, "/saved-foods?notice=Meal%20favorited"); });

  app.get("/scan", (request, response) => send(response, renderScanModePage(scanMode(request.query.mode))));
  app.post("/scan/barcode", async (request, response) => {
    try {
      const candidate = await barcodeAdapter.lookup(text(request.body.barcode));
      const token = candidateToken(candidate);
      return send(response, renderPage({ title: candidate.name, active: "scan", content: renderReviewSurface({ title: candidate.name, profile: candidateReviewProfile(candidate), source: candidate.source, warnings: candidate.warnings, timezone: store.getTimezone(config.timezone), token }) }));
    } catch (error) {
      const failure = error instanceof ProviderFailure ? error : new ProviderFailure("unexpected", "Barcode lookup failed.");
      logger.warn("barcode_lookup_failed", { operation: "barcode_lookup", provider: "configured", failure: failure.kind, retryable: failure.retryable });
      return send(response, renderErrorPage(providerFailureTitle(failure.kind, "Barcode lookup"), `${failure.message} ${providerFailureGuidance(failure)}`, "scan", failure.retryable ? "/scan/barcode" : undefined, { barcode: text(request.body.barcode) }), failure.kind === "invalid" ? 400 : 200);
    }
  });
  app.post("/scan/label", upload.single("image"), async (request, response) => {
    try {
      if (!request.file) throw new ProviderFailure("invalid", "Choose a label image.", { retryable: false, manualFallback: true });
      validateImageInput({ buffer: request.file.buffer, mimeType: request.file.mimetype, fileName: request.file.originalname }, config.maxImageBytes);
      if (!labelAdapter) throw new ProviderFailure("unexpected", "Food Label extraction is not configured. You can enter the values manually.", { retryable: false, manualFallback: true });
      const candidate = await labelAdapter.extract({ buffer: request.file.buffer, mimeType: request.file.mimetype, fileName: request.file.originalname });
      const token = candidateToken({ ...candidate, buffer: request.file.buffer, mimeType: request.file.mimetype, originalName: request.file.originalname });
      return send(response, renderPage({ title: "Food Label review", active: "scan", content: renderReviewSurface({ title: "Food Label review", profile: candidateReviewProfile(candidate), source: "Food Label candidate", warnings: candidate.warnings, timezone: store.getTimezone(config.timezone), token }) }));
    } catch (error) { const failure = error instanceof ProviderFailure ? error : new ProviderFailure("unexpected", "Food Label extraction failed."); return send(response, renderErrorPage(providerFailureTitle(failure.kind, "Food Label extraction"), `${failure.message} ${providerFailureGuidance(failure)}`, "scan", failure.retryable ? "/scan" : undefined, { mode: "label" }, "get"), failure.kind === "invalid" ? 400 : 200); }
  });

  app.post("/scan/food", upload.single("image"), async (request, response) => {
    try {
      if (!request.file) throw new ProviderFailure("invalid", "Choose a food image.", { retryable: false, manualFallback: true });
      validateImageInput({ buffer: request.file.buffer, mimeType: request.file.mimetype, fileName: request.file.originalname }, config.maxImageBytes);
      if (!aiAdapter) throw new ProviderFailure("unexpected", "AI food analysis is not configured. You can continue with a manual Food.", { retryable: false, manualFallback: true });
      const analysis = await aiAdapter.analyze({ buffer: request.file.buffer, mimeType: request.file.mimetype, fileName: request.file.originalname });
      if (!analysis.isFood) return send(response, renderErrorPage("No food identified", "The image did not contain clearly identifiable food. Nothing was created or logged.", "scan"));
      const ingredients = await Promise.all(analysis.ingredients.map(async (ingredient) => {
        try { return { ...ingredient, matches: await searchAdapter.search(ingredient.name) }; } catch { return ingredient; }
      }));
      const token = cryptoToken();
      analyses.set(token, { analysis: { ...analysis, ingredients }, buffer: request.file.buffer, mimeType: request.file.mimetype, originalName: request.file.originalname });
      return send(response, renderAnalysis(token, { ...analysis, ingredients }));
    } catch (error) { const failure = error instanceof ProviderFailure ? error : new ProviderFailure("unexpected", "Food image analysis failed."); return send(response, renderErrorPage(providerFailureTitle(failure.kind, "Food image analysis"), `${failure.message} ${providerFailureGuidance(failure)}`, "scan", failure.retryable ? "/scan" : undefined, { mode: "food" }, "get"), failure.kind === "invalid" ? 400 : 200); }
  });
  app.post("/scan/food/:token/ingredient/:index/delete", (request, response) => { const proposal = analyses.get(request.params.token); if (!proposal) return send(response, renderErrorPage("Proposal expired", "Run the image analysis again.", "scan"), 404); proposal.analysis.ingredients.splice(Number(request.params.index), 1); return send(response, renderAnalysis(request.params.token, proposal.analysis)); });
  app.post("/scan/food/:token/ingredient/:index/match", (request, response) => { const proposal = analyses.get(request.params.token); const index = Number(request.params.index); const ingredient = proposal?.analysis.ingredients[index]; const matchIndex = Number(request.body.matchIndex); if (!proposal || !ingredient || !ingredient.matches?.[matchIndex]) return send(response, renderErrorPage("Match not found", "Choose one of the available matches.", "scan"), 400); ingredient.matches = [ingredient.matches[matchIndex]]; return send(response, renderAnalysis(request.params.token, proposal.analysis)); });
  app.get("/scan/food/:token/ingredient/:index/manual", (request, response) => { const proposal = analyses.get(request.params.token); const index = Number(request.params.index); const ingredient = proposal?.analysis.ingredients[index]; if (!proposal || !ingredient) return send(response, renderErrorPage("Ingredient proposal not found", "Run the image analysis again.", "scan"), 404); return send(response, renderPage({ title: "Manual ingredient Food", active: "scan", content: `<section class="form-panel"><p class="eyebrow">Manual fallback</p><h1>${escapeHtml(ingredient.name)}</h1><p class="muted">No provider match was selected. Calories and declared quantity basis are required before this ingredient can be confirmed.</p><form method="post" action="/scan/food/${encodeURIComponent(request.params.token)}/ingredient/${index}/manual" class="stack-form"><label>Food name <input name="name" value="${escapeHtml(ingredient.name)}" required></label><label>Declared basis <input name="quantityBasis" value="${escapeHtml(ingredient.unit)}" required></label><label>Calories (kcal) <input name="calories" required inputmode="decimal"></label><label>Protein (g) <input name="protein" inputmode="decimal"></label><label>Carbohydrates (g) <input name="carbohydrates" inputmode="decimal"></label><label>Fat (g) <input name="fat" inputmode="decimal"></label><button class="button" type="submit">Save manual draft for review</button></form></section>` })); });
  app.post("/scan/food/:token/ingredient/:index/manual", (request, response) => { const proposal = analyses.get(request.params.token); const index = Number(request.params.index); const ingredient = proposal?.analysis.ingredients[index]; if (!proposal || !ingredient) return send(response, renderErrorPage("Ingredient proposal not found", "Run the image analysis again.", "scan"), 404); try { const manual: FoodCandidate = { name: text(request.body.name, ingredient.name), brand: null, description: null, quantityBasis: text(request.body.quantityBasis, ingredient.unit), basisQuantity: 1, nutrients: { calories: numberRequired(request.body.calories, "Calories"), protein: numberOrNull(request.body.protein), carbohydrates: numberOrNull(request.body.carbohydrates), fat: numberOrNull(request.body.fat) }, source: "Manual ingredient draft", warnings: [], complete: true, requiresReview: true }; ingredient.matches = [manual]; return send(response, renderAnalysis(request.params.token, proposal.analysis)); } catch (error) { return send(response, renderErrorPage("Manual draft needs correction", error instanceof Error ? error.message : "Calories are required.", "scan"), 400); } });
  app.get("/scan/food/:token/ingredient/:index/edit", (request, response) => { const proposal = analyses.get(request.params.token); const index = Number(request.params.index); const ingredient = proposal?.analysis.ingredients[index]; if (!proposal || !ingredient) return send(response, renderErrorPage("Ingredient proposal not found", "Run the image analysis again.", "scan"), 404); return send(response, renderPage({ title: "Edit ingredient proposal", active: "scan", content: `<section class="form-panel"><p class="eyebrow">Candidate edit</p><h1>Edit ${escapeHtml(ingredient.name)}</h1><form method="post" action="/scan/food/${encodeURIComponent(request.params.token)}/ingredient/${index}/edit" class="stack-form"><label>Name <input name="name" value="${escapeHtml(ingredient.name)}" required></label><label>Quantity <input name="quantity" value="${escapeHtml(ingredient.quantity)}" required></label><label>Unit <input name="unit" value="${escapeHtml(ingredient.unit)}" required></label><button class="button" type="submit">Save proposal edit</button></form></section>` })); });
  app.post("/scan/food/:token/ingredient/:index/edit", (request, response) => { const proposal = analyses.get(request.params.token); const index = Number(request.params.index); const ingredient = proposal?.analysis.ingredients[index]; if (!proposal || !ingredient) return send(response, renderErrorPage("Ingredient proposal not found", "Run the image analysis again.", "scan"), 404); proposal.analysis.ingredients[index] = { ...ingredient, name: text(request.body.name, ingredient.name).trim(), quantity: text(request.body.quantity, ingredient.quantity).trim(), unit: text(request.body.unit, ingredient.unit).trim() }; return send(response, renderAnalysis(request.params.token, proposal.analysis)); });
  app.post("/scan/food/:token/confirm", async (request, response) => {
    const proposal = analyses.get(request.params.token);
    if (!proposal) return send(response, renderErrorPage("Proposal expired", "Run the image analysis again.", "scan"), 404);
    let stored: Awaited<ReturnType<ImageStorage["save"]>> | undefined;
    try {
      if (!proposal.analysis.ingredients.length) throw new Error("Add at least one ingredient before confirmation.");
      const confirmed = proposal.analysis.ingredients.map((ingredient) => {
        if (!ingredient.matches || ingredient.matches.length !== 1) throw new Error(`${ingredient.name} needs one confirmed match or a manual Food with calories.`);
        return { ingredient, food: { ...candidateProfile(ingredient.matches[0] as StoredCandidate), source: "image-reviewed" } };
      });
      if (proposal.buffer && proposal.mimeType) {
        stored = await imageStorage.save({ buffer: proposal.buffer, mimeType: proposal.mimeType, originalName: proposal.originalName || "food-image" }, config.maxImageBytes);
      }
      const meal = store.createMealFromConfirmedFoods(confirmed.map((item) => ({ food: item.food, quantity: item.ingredient.quantity, unit: item.ingredient.unit })), stored);
      analyses.delete(request.params.token);
      return redirect(response, `/meals/${meal.id}/edit`);
    } catch (error) {
      if (stored) await imageStorage.delete(stored.managedName).catch(() => undefined);
      return send(response, renderErrorPage("Ingredient confirmation required", error instanceof Error ? error.message : "Review each ingredient before confirmation.", "scan"), 400);
    }
  });
  app.post("/scan/food/:token/ingredient/:index/edit-ai", async (request, response) => { const proposal = analyses.get(request.params.token); const index = Number(request.params.index); if (!proposal || !proposal.analysis.ingredients[index] || !aiAdapter) return send(response, renderErrorPage("Proposal unavailable", "The AI edit provider is not configured.", "scan"), 400); try { const edit = await aiAdapter.proposeEdit({ instruction: text(request.body.instruction), ingredients: [proposal.analysis.ingredients[index]] }); const token = cryptoToken(); aiProposals.set(token, { analysisToken: request.params.token, index, ingredients: edit.ingredients, message: edit.message }); return send(response, renderAiProposalPage(token, edit.message, edit.ingredients)); } catch (error) { return send(response, renderErrorPage("AI edit unavailable", error instanceof Error ? error.message : "Try again later.", "scan"), 503); } });
  app.post("/scan/food/:token/edit-ai", async (request, response) => { const proposal = analyses.get(request.params.token); if (!proposal || !aiAdapter) return send(response, renderErrorPage("Proposal unavailable", "The AI edit provider is not configured.", "scan"), 400); try { const edit = await aiAdapter.proposeEdit({ instruction: text(request.body.instruction), ingredients: proposal.analysis.ingredients }); const token = cryptoToken(); aiProposals.set(token, { analysisToken: request.params.token, ingredients: edit.ingredients, message: edit.message }); return send(response, renderAiProposalPage(token, edit.message, edit.ingredients)); } catch (error) { return send(response, renderErrorPage("AI edit unavailable", error instanceof Error ? error.message : "Try again later.", "scan"), 503); } });
  app.post("/scan/food/proposals/:token/confirm", (request, response) => { const proposal = aiProposals.get(request.params.token); const analysis = proposal ? analyses.get(proposal.analysisToken) : undefined; if (!proposal || !analysis) return send(response, renderErrorPage("Proposal expired", "Run the image analysis again.", "scan"), 404); if (proposal.index === undefined) analysis.analysis.ingredients = proposal.ingredients; else if (proposal.ingredients[0]) analysis.analysis.ingredients[proposal.index] = proposal.ingredients[0]; aiProposals.delete(request.params.token); return send(response, renderAnalysis(proposal.analysisToken, analysis.analysis)); });
  app.post("/scan/food/proposals/:token/dismiss", (request, response) => { const proposal = aiProposals.get(request.params.token); aiProposals.delete(request.params.token); return proposal ? redirect(response, `/scan/food/${encodeURIComponent(proposal.analysisToken)}/review`) : redirect(response, "/scan"); });
  app.get("/scan/food/:token/review", (request, response) => { const proposal = analyses.get(request.params.token); return proposal ? send(response, renderAnalysis(request.params.token, proposal.analysis)) : send(response, renderErrorPage("Proposal expired", "Run the image analysis again.", "scan"), 404); });

  app.get("/saved-foods/meals/new", (request, response) => send(response, renderPage({ title: "Create Meal", active: "saved", content: `<section class="form-panel"><p class="eyebrow">Saved Foods</p><h1>Create Meal</h1><p>Build one reusable assembled unit from confirmed Foods. Meal nutrition is explained by its ingredient portions.</p><form method="post" action="/meals" class="stack-form"><label>Meal name <input name="name" required></label><label>Description <textarea name="description" rows="2"></textarea></label><button class="button" type="submit">Create Meal</button></form></section>` })));
  app.post("/meals", (request, response) => { try { const meal = store.createMeal(text(request.body.name), text(request.body.description) || null); return redirect(response, `/meals/${meal.id}/edit`); } catch (error) { return send(response, renderErrorPage("Meal could not be created", error instanceof Error ? error.message : "Enter a meal name.", "saved"), 400); } });
  app.get("/meals/:id/edit", (request, response) => { const meal = store.getMeal(Number(request.params.id)); return meal ? send(response, renderMealEditor(store, meal)) : send(response, renderErrorPage("Meal not found", "That Meal no longer exists.", "saved"), 404); });
  app.post("/meals/:id/ingredients", (request, response) => { try { const meal = store.addMealIngredient(Number(request.params.id), numberRequired(request.body.foodId, "Food"), text(request.body.quantity, "1"), text(request.body.unit) || undefined); return redirect(response, `/meals/${meal.id}/edit`); } catch (error) { const meal = store.getMeal(Number(request.params.id)); return meal ? send(response, renderMealEditor(store, meal, error instanceof Error ? error.message : "Ingredient could not be added."), 400) : send(response, renderErrorPage("Meal not found", "That Meal no longer exists.", "saved"), 404); } });
  app.post("/meal-ingredients/:id", (request, response) => { try { const meal = store.updateMealIngredient(Number(request.params.id), text(request.body.quantity), text(request.body.unit) || undefined); return redirect(response, `/meals/${meal.id}/edit`); } catch (error) { return send(response, renderErrorPage("Ingredient could not be updated", error instanceof Error ? error.message : "Invalid quantity.", "saved"), 400); } });
  app.post("/meal-ingredients/:id/replace", (request, response) => { try { const meal = store.replaceMealIngredient(Number(request.params.id), numberRequired(request.body.foodId, "Food"), text(request.body.quantity, "1"), text(request.body.unit) || undefined); return redirect(response, `/meals/${meal.id}/edit`); } catch (error) { return send(response, renderErrorPage("Ingredient could not be replaced", error instanceof Error ? error.message : "Choose a confirmed Food and valid quantity.", "saved"), 400); } });
  app.post("/meal-ingredients/:id/delete", (request, response) => { store.removeMealIngredient(Number(request.params.id)); return redirect(response, "/saved-foods?notice=Ingredient%20removed"); });
  app.post("/meals/:id/favorite", (request, response) => { store.favoriteMeal(Number(request.params.id)); return redirect(response, `/meals/${request.params.id}/edit`); });
  app.post("/meals/:id/unfavorite", (request, response) => { store.unfavoriteMeal(Number(request.params.id)); return redirect(response, "/saved-foods?notice=Favorite%20removed"); });
  app.post("/meals/:id/delete", (request, response) => { store.deleteMeal(Number(request.params.id)); return redirect(response, "/saved-foods?notice=Meal%20deleted"); });
  app.post("/meals/:id/image", upload.single("image"), async (request, response) => {
    const meal = store.getMeal(Number(request.params.id));
    try {
      if (!meal || !request.file) throw new Error("Meal and image are required.");
      const stored = await imageStorage.save({ buffer: request.file.buffer, mimeType: request.file.mimetype, originalName: request.file.originalname }, config.maxImageBytes);
      try { store.addImageRecord({ ...stored, foodId: null, mealId: meal.id }); } catch (error) { await imageStorage.delete(stored.managedName); throw error; }
      return redirect(response, `/meals/${meal.id}/edit`);
    } catch (error) { return send(response, renderErrorPage("Image could not be retained", error instanceof Error ? error.message : "Invalid image.", "saved"), 400); }
  });
  app.post("/images/:id/delete", async (request, response) => {
    const image = store.getImage(Number(request.params.id));
    if (!image) return redirect(response, "/settings/data?notice=Image%20not%20found");
    let deleted: ReturnType<Store["deleteImageRecord"]> = null;
    try {
      deleted = store.deleteImageRecord(image.id);
      await imageStorage.delete(image.managedName);
      return redirect(response, "/settings/data?notice=Image%20deleted");
    } catch (error) {
      if (deleted && !store.getImage(image.id)) store.restoreImageRecord(deleted);
      return redirect(response, `/settings/data?notice=${encodeURIComponent(error instanceof Error ? error.message : "Image deletion failed")}`);
    }
  });

  app.get("/entries/:id/edit", (request, response) => { const foodEntry = store.getFoodEntry(Number(request.params.id)); if (!foodEntry) return send(response, renderErrorPage("Food entry not found", "That historical Food entry no longer exists.", "log"), 404); return send(response, renderFoodEntryEditor(foodEntry, store.getTimezone(config.timezone))); });
  app.post("/entries/:id", (request, response) => { try { const timezone = store.getTimezone(config.timezone); const existing = store.getFoodEntry(Number(request.params.id)); if (!existing) throw new Error("Food entry not found."); const loggedAtUtc = utcFromLocal(text(request.body.date), text(request.body.time), timezone); const profile = request.body.editDetails === "1" ? parseProfileForm(request.body as Record<string, unknown>, profileFromEntry(existing)) : undefined; const updated = store.updateFoodEntry(Number(request.params.id), { quantity: text(request.body.quantity), loggedAtUtc, mealTag: (text(request.body.mealTag) || null) as MealTag | null, profile }, timezone); return redirect(response, `/log?date=${encodeURIComponent(localDateFor(updated.loggedAtUtc, timezone))}&notice=Food%20entry%20updated`); } catch (error) { return send(response, renderErrorPage("Food entry could not be updated", error instanceof Error ? error.message : "Check the date, time, and quantity.", "log"), 400); } });
  app.post("/entries/:id/delete", (request, response) => { const foodEntry = store.deleteFoodEntry(Number(request.params.id)); if (!foodEntry) return redirect(response, "/log"); undoFoodEntries.set(foodEntry.id, foodEntry); const timeout = setTimeout(() => undoFoodEntries.delete(foodEntry.id), 5 * 60 * 1000); timeout.unref(); const date = localDateFor(foodEntry.loggedAtUtc, store.getTimezone(config.timezone)); return redirect(response, `/log?date=${encodeURIComponent(date)}&undo=${foodEntry.id}&notice=${encodeURIComponent("Food entry deleted. Undo is available briefly.")}`); });
  app.post("/entries/:id/undo", (request, response) => { const foodEntry = undoFoodEntries.get(Number(request.params.id)); if (foodEntry) { store.restoreFoodEntry(foodEntry); undoFoodEntries.delete(foodEntry.id); } return redirect(response, "/log?notice=Food%20entry%20restored"); });
  app.post("/entries/:id/favorite", (request, response) => { store.saveFoodEntryAsFavorite(Number(request.params.id)); return redirect(response, "/saved-foods?notice=Snapshot%20saved%20as%20an%20independent%20Food"); });

  app.get("/targets", (request, response) => { const proposalToken = text(request.query.proposal); const proposal = proposalToken ? proposals.get(proposalToken) : undefined; return send(response, renderTargetPage(store, config, proposal ? { token: proposalToken, estimate: proposal } : undefined, text(request.query.error))); });
  app.post("/targets/manual", (request, response) => { try { const references: NutrientReferences = {}; const proteinMin = numberOrNull(request.body.proteinMin); const proteinMax = numberOrNull(request.body.proteinMax); if (proteinMin !== null || proteinMax !== null) references.protein = { type: "range", min: proteinMin ?? undefined, max: proteinMax ?? undefined, label: "manual protein range" }; const carbohydratesMin = numberOrNull(request.body.carbohydratesMin); const carbohydratesMax = numberOrNull(request.body.carbohydratesMax); if (carbohydratesMin !== null || carbohydratesMax !== null) references.carbohydrates = { type: "range", min: carbohydratesMin ?? undefined, max: carbohydratesMax ?? undefined, label: "manual carbohydrate range" }; const fatMin = numberOrNull(request.body.fatMin); const fatMax = numberOrNull(request.body.fatMax); if (fatMin !== null || fatMax !== null) references.fat = { type: "range", min: fatMin ?? undefined, max: fatMax ?? undefined, label: "manual fat range" }; const fiberMin = numberOrNull(request.body.fiberMin); if (fiberMin !== null) references.fiber = { type: "minimum", min: fiberMin, label: "manual minimum" }; const saturatedFatMax = numberOrNull(request.body.saturatedFatMax); if (saturatedFatMax !== null) references.saturatedFat = { type: "upper", max: saturatedFatMax, label: "manual upper reference" }; const sodiumMax = numberOrNull(request.body.sodiumMax); if (sodiumMax !== null) references.sodium = { type: "upper", max: sodiumMax, label: "manual upper reference" }; const addedSugarMax = numberOrNull(request.body.addedSugarMax); if (addedSugarMax !== null) references.addedSugar = { type: "label", value: addedSugarMax, label: "manual label context" }; store.createTarget({ kind: "manual", calories: numberOrNull(request.body.calories), references, active: true }); return redirect(response, "/targets"); } catch (error) { return redirect(response, `/targets?error=${encodeURIComponent(error instanceof Error ? error.message : "Target could not be saved.")}`); } });
  app.post("/targets/estimate", (request, response) => { try { const input: NutritionEstimateInput = { age: numberRequired(request.body.age, "Age"), sex: text(request.body.sex) as NutritionEstimateInput["sex"], heightCm: numberRequired(request.body.heightCm, "Height"), weightKg: numberRequired(request.body.weightKg, "Weight"), activity: text(request.body.activity) as NutritionEstimateInput["activity"], plan: text(request.body.plan) as NutritionEstimateInput["plan"], targetWeightKg: numberOrNull(request.body.targetWeightKg) ?? undefined, targetDate: text(request.body.targetDate) || undefined, today: currentLocalDate(store.getTimezone(config.timezone)) }; const estimate = estimateNutrition(input); const token = cryptoToken(); proposals.set(token, estimate); return redirect(response, `/targets?proposal=${encodeURIComponent(token)}`); } catch (error) { return redirect(response, `/targets?error=${encodeURIComponent(error instanceof Error ? error.message : "Estimate could not be generated.")}`); } });
  app.post("/targets/proposals/:token/confirm", (request, response) => { const estimate = proposals.get(request.params.token); if (!estimate) return redirect(response, "/targets?error=Proposal%20expired"); store.createTarget({ kind: "estimate", plan: estimate.plan, calories: estimate.targetCalories, references: estimate.references, metadata: estimate.metadata as unknown as Record<string, unknown>, active: true }); proposals.delete(request.params.token); return redirect(response, "/targets"); });
  app.post("/targets/:id/disable", (request, response) => { store.updateTarget(Number(request.params.id), { active: false }); return redirect(response, "/targets"); });
  app.post("/targets/:id/reference", (request, response) => { try { const target = store.getTarget(Number(request.params.id)); const nutrient = text(request.body.nutrient) as NutrientKey | "proteinAdequacy"; if (!target || !(nutrient in target.references)) throw new Error("Reference not found."); const existing = target.references[nutrient]; if (!existing) throw new Error("Reference not found."); const references = { ...target.references, [nutrient]: request.body.action === "disable" ? { ...existing, enabled: false } : { ...existing, enabled: true, min: numberOrNull(request.body.min) ?? existing.min, max: numberOrNull(request.body.max) ?? existing.max, value: numberOrNull(request.body.value) ?? existing.value } }; store.updateTarget(target.id, { references }); return redirect(response, "/targets"); } catch (error) { return redirect(response, `/targets?error=${encodeURIComponent(error instanceof Error ? error.message : "Reference could not be updated.")}`); } });
  app.get("/settings", (request, response) => redirect(response, "/targets"));
  app.post("/settings/timezone/seed", (request, response) => { try { store.seedBrowserTimezone(text(request.body.timezone)); return response.status(204).end(); } catch { return response.status(400).end(); } });
  app.post("/settings/timezone", (request, response) => { try { store.updateTimezone(text(request.body.timezone)); return redirect(response, "/targets"); } catch (error) { return redirect(response, `/targets?error=${encodeURIComponent(error instanceof Error ? error.message : "Invalid timezone")}`); } });

  app.get("/settings/data", (request, response) => send(response, renderDataPage(store, text(request.query.notice))));
  app.post("/settings/data/export", async (request, response) => { try { const exportDirectory = await writeExport(config.dataDir, store); return redirect(response, `/settings/data?notice=${encodeURIComponent(`Export created under ${path.basename(exportDirectory)}`)}`); } catch (error) { return redirect(response, `/settings/data?notice=${encodeURIComponent(error instanceof Error ? error.message : "Export failed")}`); } });
  app.post("/settings/data/delete-all", async (request, response) => { if (text(request.body.confirmation) !== "DELETE") return redirect(response, "/settings/data?notice=Type%20DELETE%20to%20confirm"); try { await deleteAllOwnedData(config.dataDir, store); return redirect(response, "/log?notice=All%20owned%20data%20was%20deleted"); } catch (error) { return redirect(response, `/settings/data?notice=${encodeURIComponent(error instanceof Error ? error.message : "Delete failed; restore from backup")}`); } });

  app.use(express.static(publicDirectory));
  app.use((error: unknown, _request: Request, response: Response, _next: unknown) => { logger.error("http_request_failed", { operation: "request", error: error instanceof Error ? error.name : "unknown" }); if (!response.headersSent) response.status(500).send(renderErrorPage("Unexpected error", "The request failed without exposing private provider or nutrition details.", "log")); });

  return { app, config, store, connection, close: () => { if (ownsConnection) connection.sqlite.close(); } };
}

function cryptoToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
