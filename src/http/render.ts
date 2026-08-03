import {
  formatNutritionValue,
  NUTRIENT_DEFINITIONS,
  summarizeNutrition,
  type DailySummary,
  type FoodProfile,
  type NutrientKey,
  type NutrientSummary,
  type NutrientReferences,
  type NutrientValues,
} from "../domain/nutrition.js";
import { nutrientsForDisplay, type EntryRecord, type FoodRecord, type MealRecord, type TargetRecord } from "../persistence/store.js";

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderNutritionList(nutrients: NutrientValues | FoodProfile["nutrients"] | Partial<NutrientValues>, options: { compact?: boolean } = {}): string {
  const values = nutrientsForDisplay(nutrients);
  return `<dl class="nutrition-list${options.compact ? " nutrition-list--compact" : ""}">
    ${values.map((item) => `<div class="nutrition-item${item.known ? "" : " nutrition-item--unknown"}">
      <dt>${escapeHtml(item.label)}</dt>
      <dd>${escapeHtml(item.value)} <span>${escapeHtml(item.unit)}</span></dd>
      ${item.known ? "" : "<small>Unknown</small>"}
    </div>`).join("")}
  </dl>`;
}

export function renderSummary(summary: DailySummary, target: TargetRecord | null): string {
  const calorieTarget = target?.calories;
  return `<section class="summary-card" aria-labelledby="summary-heading">
    <div class="section-heading"><div><p class="eyebrow">Daily summary</p><h2 id="summary-heading">What is logged</h2></div><span class="status-chip">${target ? "Target confirmed" : "No target set"}</span></div>
    <div class="calorie-total"><span>Calories</span><strong>${escapeHtml(summary.nutrients[0].display)}</strong><small>${calorieTarget === null || calorieTarget === undefined ? "Set a calorie goal when you want one" : `${Math.round(calorieTarget)} kcal target`}</small></div>
    <div class="summary-grid">
      ${summary.nutrients.slice(1).map((item) => `<article class="summary-metric">
        <div class="metric-top"><span>${escapeHtml(item.label)}</span><strong>${escapeHtml(item.display)} <small>${escapeHtml(item.unit)}</small></strong></div>
        ${hasProgressReference(item.reference) ? `<div class="metric-track" aria-hidden="true"><span style="width:${metricWidth(item.value, item.reference?.max ?? item.reference?.value)}%"></span></div>` : ""}
        <p>${item.missing ? "Optional value unknown" : item.status || item.reference?.label || "No active reference"}</p>
      </article>`).join("")}
    </div>
    ${summary.hasMissingData ? `<p class="notice notice--warning" role="status">Some optional nutrients are unknown. They contribute zero to totals, but are not treated as known zero.</p>` : ""}
  </section>`;
}

function metricWidth(value: number, maximum?: number): number {
  if (!maximum || maximum <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round(value / maximum * 100)));
}

function hasProgressReference(reference: NutrientSummary["reference"]): boolean {
  return Boolean(reference && reference.enabled !== false && ["target", "minimum", "range", "upper"].includes(reference.type));
}

export function renderFoodCard(food: FoodRecord, href = `/review?foodId=${food.id}`): string {
  return `<article class="food-card">
    <div><p class="eyebrow">${escapeHtml(food.source)}</p><h3>${escapeHtml(food.name)}</h3>${food.brand ? `<p class="muted">${escapeHtml(food.brand)}</p>` : ""}<p class="muted">${escapeHtml(food.quantityBasis)} / ${escapeHtml(formatNutritionValue("calories", food.nutrients.calories))} kcal</p></div>
    <a class="button button--quiet" href="${escapeHtml(href)}">Review</a>
  </article>`;
}

export function renderMealCard(meal: MealRecord): string {
  return `<article class="food-card">
    <div><p class="eyebrow">${meal.favorite ? "Favorite meal" : "My meal"}</p><h3>${escapeHtml(meal.name)}</h3><p class="muted">${meal.ingredients.length} ingredient${meal.ingredients.length === 1 ? "" : "s"} / ${escapeHtml(formatNutritionValue("calories", meal.nutrients.calories))} kcal per meal unit</p></div>
    <a class="button button--quiet" href="/review?mealId=${meal.id}">Review</a>
  </article>`;
}

export function renderEntry(entry: EntryRecord): string {
  const nutrition = entry.snapshot;
  return `<article class="entry-card">
    <div class="entry-main"><div class="entry-title"><h3>${escapeHtml(entry.title)}</h3>${entry.mealTag ? `<span class="tag">${escapeHtml(entry.mealTag)}</span>` : ""}</div><p class="muted">${escapeHtml(entry.localTime || "")} / ${escapeHtml(entry.quantity.display)} ${escapeHtml(entry.quantity.unit)}</p></div>
    <dl class="entry-nutrients"><div><dt>Calories</dt><dd>${escapeHtml(formatNutritionValue("calories", nutrition.calories))}</dd></div><div><dt>Protein</dt><dd>${escapeHtml(formatNutritionValue("protein", nutrition.protein))} g</dd></div><div><dt>Carbs</dt><dd>${escapeHtml(formatNutritionValue("carbohydrates", nutrition.carbohydrates))} g</dd></div><div><dt>Fat</dt><dd>${escapeHtml(formatNutritionValue("fat", nutrition.fat))} g</dd></div></dl>
    <details class="entry-actions"><summary aria-label="Actions for ${escapeHtml(entry.title)}">More</summary><div class="entry-menu"><a href="/entries/${entry.id}/edit">Edit Entry</a><form method="post" action="/entries/${entry.id}/delete" onsubmit="return confirm('Delete this entry?')"><button type="submit" class="link-button">Delete Entry</button></form><form method="post" action="/entries/${entry.id}/favorite"><button type="submit" class="link-button">Save as Favorite</button></form></div></details>
  </article>`;
}

type ReviewProfile = Omit<FoodProfile, "nutrients"> & { nutrients: Partial<Record<NutrientKey, number | null>> };

export function renderReviewSurface(input: { title: string; profile: ReviewProfile; source: string; token?: string; foodId?: number; mealId?: number; error?: string; warnings?: string[]; timezone?: string }): string {
  const formTarget = input.token ? `/review/candidate/${encodeURIComponent(input.token)}` : input.foodId ? `/review/food/${input.foodId}` : `/review/meal/${input.mealId}`;
  const actionTarget = input.token ? `/review/candidate/${encodeURIComponent(input.token)}/add` : input.foodId ? `/review/food/${input.foodId}/add` : `/review/meal/${input.mealId}/add`;
  const saveTarget = input.token ? `/review/candidate/${encodeURIComponent(input.token)}/save` : input.foodId ? `/review/food/${input.foodId}/favorite` : `/review/meal/${input.mealId}/favorite`;
  const basis = input.profile.basisQuantity ? `${input.profile.basisQuantity} ${input.profile.quantityBasis}` : input.profile.quantityBasis;
  const nutrientFields = NUTRIENT_DEFINITIONS.map((definition) => `<label>${escapeHtml(definition.label)} (${escapeHtml(definition.unit)}) <input name="${escapeHtml(definition.key)}" value="${escapeHtml(input.profile.nutrients[definition.key])}" inputmode="decimal" ${definition.key === "calories" ? "required" : ""}></label>`).join("");
  const reviewDate = localDate(input.timezone);
  const reviewTime = localTime(input.timezone);
  return `<section class="review-panel" aria-labelledby="review-heading">
    <p class="eyebrow">${escapeHtml(input.source)}</p><h1 id="review-heading">${escapeHtml(input.title)}</h1>
    ${input.profile.brand ? `<p class="lead">${escapeHtml(input.profile.brand)}</p>` : ""}
    <p class="muted">Declared basis: ${escapeHtml(basis)}</p>
    ${input.error ? `<p class="notice notice--error" role="alert">${escapeHtml(input.error)}</p>` : ""}
    ${(input.warnings ?? []).map((warning) => `<p class="notice notice--warning" role="status">${escapeHtml(warning)}</p>`).join("")}
    <details class="form-panel" style="margin-top:20px"><summary>Edit candidate values</summary><div class="stack-form"><label>Name <input form="review-add" name="name" value="${escapeHtml(input.profile.name)}" required></label><label>Declared quantity basis <input form="review-add" name="quantityBasis" value="${escapeHtml(input.profile.quantityBasis)}" required></label><div class="form-grid">${nutrientFields.replaceAll("<input ", "<input form=\"review-add\" ")}</div></div></details>
    ${renderNutritionList(input.profile.nutrients)}
    <form id="review-add" method="post" action="${escapeHtml(actionTarget)}" class="stack-form">
      <label>Quantity <input name="quantity" value="1" inputmode="decimal" required></label>
      <label>Local date <input name="date" type="date" value="${escapeHtml(reviewDate)}" required></label>
      <label>Local time <input name="time" type="time" value="${escapeHtml(reviewTime)}" required></label>
      <label>Meal tag <select name="mealTag"><option value="">No tag</option><option>Breakfast</option><option>Lunch</option><option>Dinner</option><option>Snack</option></select></label>
      <button class="button" type="submit">Add to Log</button>
    </form>
    <form method="post" action="${escapeHtml(saveTarget)}" class="inline-form"><button class="button button--secondary" type="submit">${input.mealId ? "Favorite Meal" : "Save to Saved Foods"}</button></form>
  </section>`;
}

function localDate(timezone = "UTC"): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function localTime(timezone = "UTC"): string {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const values = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));
  return `${values.hour}:${values.minute}`;
}

export function renderPage(input: { title: string; content: string; active?: "log" | "database" | "saved" | "targets" | "scan"; notice?: string }): string {
  const active = input.active || "log";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(input.title)} / Calories</title><link rel="stylesheet" href="/styles.css"><script src="https://unpkg.com/htmx.org@2.0.4"></script></head><body>
    <div class="app-shell"><header class="topbar"><a class="brand" href="/log"><span class="brand-mark" aria-hidden="true">C</span><span>Calories</span></a><span class="instance-status">Local instance</span></header>
    <nav class="primary-nav" aria-label="Primary navigation"><a class="${active === "log" ? "is-active" : ""}" href="/log">Log</a><a class="${active === "database" ? "is-active" : ""}" href="/database">Food Database</a><a class="${active === "saved" ? "is-active" : ""}" href="/saved-foods">Saved Foods</a></nav>
    <main class="content">${input.notice ? `<p class="notice notice--success" role="status">${escapeHtml(input.notice)}</p>` : ""}${input.content}</main>
    <nav class="mobile-nav" aria-label="Mobile navigation"><a class="${active === "log" ? "is-active" : ""}" href="/log">Log</a><a class="${active === "database" ? "is-active" : ""}" href="/database">Food Database</a><a class="${active === "saved" ? "is-active" : ""}" href="/saved-foods">Saved Foods</a></nav></div>
  </body></html>`;
}

export function renderEmptyState(title: string, message: string, href: string, action: string): string {
  return `<section class="empty-state"><p class="eyebrow">Nothing here yet</p><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p><a class="button" href="${escapeHtml(href)}">${escapeHtml(action)}</a></section>`;
}

export function renderReferenceTable(references: NutrientReferences): string {
  const proteinAdequacy = references.proteinAdequacy;
  return `<ul class="reference-list">${NUTRIENT_DEFINITIONS.filter(({ key }) => references[key]).map(({ key, label, unit }) => {
    const reference = references[key]!;
    const value = reference.type === "range" ? `${formatNutritionValue(key, reference.min)}-${formatNutritionValue(key, reference.max)}` : formatNutritionValue(key, reference.value ?? reference.min ?? reference.max);
    return `<li><strong>${escapeHtml(label)}</strong><span>${escapeHtml(value)} ${escapeHtml(unit)} / ${escapeHtml(reference.label || reference.type)}</span></li>`;
  }).join("")}${proteinAdequacy ? `<li><strong>Protein adequacy</strong><span>${escapeHtml(formatNutritionValue("protein", proteinAdequacy.min))} g / ${escapeHtml(proteinAdequacy.label || "adequacy reference")}</span></li>` : ""}</ul>`;
}
