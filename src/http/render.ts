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
import { nutrientsForDisplay, type FoodEntryRecord, type FoodRecord, type MealRecord, type TargetRecord } from "../persistence/store.js";

const ICON_SPRITE = `<svg class="icon-sprite" aria-hidden="true" focusable="false">
  <symbol id="icon-logo" viewBox="0 0 32 32"><path d="M16 4c6.1 0 11 4.2 11 10.1C27 21.2 22.1 27 16 28 9.9 27 5 21.2 5 14.1 5 8.2 9.9 4 16 4Z" fill="currentColor" opacity=".22"></path><path d="M16 7.2c-3.2 2.3-4.7 5.2-4.7 8.6 0 3.6 1.8 6.4 4.7 8.6 2.9-2.2 4.7-5 4.7-8.6 0-3.4-1.5-6.3-4.7-8.6Z" fill="none" stroke="currentColor" stroke-width="1.8"></path><path d="M16 8v16M16 14c-2.1-.2-3.8-1-5.2-2.4M16 18.5c2-.2 3.7-.9 5.1-2.2" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"></path></symbol>
  <symbol id="icon-log" viewBox="0 0 24 24"><path d="M5 4.5h14v15H5zM8.5 8h7M8.5 12h7M8.5 16h4" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7"></path></symbol>
  <symbol id="icon-search" viewBox="0 0 24 24"><circle cx="10.8" cy="10.8" r="5.8" fill="none" stroke="currentColor" stroke-width="1.8"></circle><path d="m15.2 15.2 4.4 4.4" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"></path></symbol>
  <symbol id="icon-bookmark" viewBox="0 0 24 24"><path d="M7 5.5A1.5 1.5 0 0 1 8.5 4h7A1.5 1.5 0 0 1 17 5.5V20l-5-3-5 3V5.5Z" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.7"></path></symbol>
  <symbol id="icon-settings" viewBox="0 0 24 24"><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" fill="none" stroke="currentColor" stroke-width="1.7"></path><path d="m19 13.5 1.2.9-1.7 2.9-1.4-.6a7.3 7.3 0 0 1-1.8 1.1l-.2 1.5h-3.4l-.2-1.5a7.3 7.3 0 0 1-1.8-1.1l-1.4.6-1.7-2.9 1.2-.9a7.7 7.7 0 0 1 0-2.2l-1.2-.9 1.7-2.9 1.4.6a7.3 7.3 0 0 1 1.8-1.1l.2-1.5h3.4l.2 1.5a7.3 7.3 0 0 1 1.8 1.1l1.4-.6 1.7 2.9-1.2.9a7.7 7.7 0 0 1 0 2.2Z" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.25"></path></symbol>
  <symbol id="icon-plus" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.8"></path></symbol>
  <symbol id="icon-help" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"></circle><path d="M9.7 9.5a2.4 2.4 0 1 1 3.8 1.9c-.9.6-1.5 1-1.5 2.1M12 16.5v.1" fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="1.7"></path></symbol>
  <symbol id="icon-chevron-left" viewBox="0 0 24 24"><path d="m14.5 6-6 6 6 6" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"></path></symbol>
  <symbol id="icon-chevron-right" viewBox="0 0 24 24"><path d="m9.5 6 6 6-6 6" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"></path></symbol>
  <symbol id="icon-arrow-right" viewBox="0 0 24 24"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7"></path></symbol>
  <symbol id="icon-arrow-up-right" viewBox="0 0 24 24"><path d="M7 17 17 7M9 7h8v8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7"></path></symbol>
  <symbol id="icon-more" viewBox="0 0 24 24"><circle cx="6" cy="12" r="1.35" fill="currentColor"></circle><circle cx="12" cy="12" r="1.35" fill="currentColor"></circle><circle cx="18" cy="12" r="1.35" fill="currentColor"></circle></symbol>
  <symbol id="icon-edit" viewBox="0 0 24 24"><path d="m14.8 5.3 3.9 3.9M5.2 18.8l.8-4.3L15.8 4.7a1.9 1.9 0 0 1 2.7 0l.8.8a1.9 1.9 0 0 1 0 2.7l-9.8 9.8-4.3.8Z" fill="none" stroke="currentColor" stroke-linejoin="round" stroke-width="1.6"></path></symbol>
  <symbol id="icon-trash" viewBox="0 0 24 24"><path d="M5.5 7.5h13M9 7.5V5h6v2.5M7.5 7.5l.8 12h7.4l.8-12M10 11v5M14 11v5" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6"></path></symbol>
  <symbol id="icon-check" viewBox="0 0 24 24"><path d="m5.5 12.5 4.1 4.1L18.8 7.4" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8"></path></symbol>
</svg>`;

function icon(name: string, className = ""): string {
  return `<svg class="icon${className ? ` ${className}` : ""}" aria-hidden="true"><use href="#icon-${name}"></use></svg>`;
}

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
  const calories = summary.nutrients[0];
  const calorieTarget = target?.calories;
  const calorieRatio = calorieTarget && calorieTarget > 0 ? Math.min(1, Math.max(0, calories.value / calorieTarget)) : 0;
  const calorieCircumference = 527.8;
  const calorieDash = `${(calorieRatio * calorieCircumference).toFixed(1)} ${calorieCircumference}`;
  const calorieRemaining = calorieTarget === null || calorieTarget === undefined
    ? "No target set"
    : calories.value >= calorieTarget
      ? `${Math.round(calories.value - calorieTarget)} kcal over target`
      : `${Math.round(calorieTarget - calories.value)} kcal remaining`;
  const missingLabels = summary.nutrients.filter((item) => item.missing && item.key !== "calories").map((item) => item.label);

  return `<div class="summary-grid">
    <section class="calorie-instrument calorie-instrument--dial" aria-labelledby="calorie-title">
      <div class="instrument-heading"><h2 id="calorie-title">Calories</h2><span class="reference-tag">${calorieTarget === null || calorieTarget === undefined ? "No target set" : "Daily target"}</span></div>
      <div class="dial-layout">
        <div class="dial-visual" aria-label="${escapeHtml(calories.display)} kcal consumed${calorieTarget ? `, ${Math.round(calorieRatio * 100)} percent of daily target` : ""}">
          <svg class="dial-svg" viewBox="0 0 220 220" aria-hidden="true"><circle class="dial-track" cx="110" cy="110" r="84"></circle><circle class="dial-progress" cx="110" cy="110" r="84" style="stroke-dasharray:${calorieDash}"></circle></svg>
          <div class="dial-center"><strong>${escapeHtml(calories.display)}</strong><span>kcal consumed</span></div>
        </div>
        <div class="dial-copy">
          <div class="calorie-reading"><strong>${escapeHtml(calories.display)}</strong><span>kcal consumed</span></div>
          <div class="calorie-footer"><span>${escapeHtml(calorieRemaining)}</span><a class="text-button" href="/targets">Adjust target ${icon("arrow-up-right", "icon--tiny")}</a></div>
        </div>
      </div>
      <div class="instrument-note"><span class="note-mark"></span><span>${target ? "Target confirmed and user-controlled" : "Set a target only when you want one"}</span></div>
    </section>

    <section class="nutrient-instrument nutrient-instrument--ring-grid" aria-labelledby="nutrient-title">
      <div class="instrument-heading"><div><h2 id="nutrient-title">Nutrient readout</h2><p class="instrument-subtitle">Reference status, not a score</p></div><span class="readout-date">${target ? "ACTIVE REFERENCE" : "NO TARGET"}</span></div>
      <div class="nutrient-list nutrient-list--ring-grid"><div class="nutrient-ring-grid">
        ${summary.nutrients.slice(1).map((item) => renderNutrientRing(item)).join("")}
      </div>
      ${summary.hasMissingData ? `<div class="missing-readout" role="status">${icon("help", "icon--tiny")}<span>${escapeHtml(missingLabels.join(", "))} ${missingLabels.length === 1 ? "is" : "are"} unknown; unknown values are not treated as zero.</span></div>` : ""}
      </div>
    </section>
  </div>`;
}

function renderNutrientRing(item: NutrientSummary): string {
  const ratio = referenceRatio(item);
  const dash = `${(ratio * 188.5).toFixed(1)} 188.5`;
  const nutrientClass = item.key === "carbohydrates" ? "carbs" : item.key === "addedSugar" ? "sugar" : item.key === "sugar" ? "total-sugar" : item.key === "saturatedFat" ? "saturated" : item.key;
  const value = item.missing ? "—" : item.display;
  const status = item.missing ? "Unknown" : item.status || "No active reference";
  return `<div class="nutrient-row nutrient-ring-item nutrient-row--${nutrientClass}${item.status === "over upper reference" ? " is-limit" : ""}">
    <div class="nutrient-ring" aria-label="${escapeHtml(`${item.label}, ${value} ${item.unit}, ${status}`)}"><svg viewBox="0 0 72 72" aria-hidden="true"><circle class="nutrient-ring-track" cx="36" cy="36" r="30"></circle><circle class="nutrient-ring-progress" cx="36" cy="36" r="30" stroke-dasharray="${dash}"></circle></svg><div class="nutrient-measure"><strong>${escapeHtml(value)}</strong><span>${escapeHtml(item.unit)}</span></div></div>
    <div class="nutrient-ring-label"><div class="nutrient-name"><span class="nutrient-dot"></span><span>${escapeHtml(item.label)}</span></div><div class="nutrient-reference">${escapeHtml(referenceText(item))}</div>${item.status === "over upper reference" ? `<span class="nutrient-alert">over upper reference</span>` : ""}</div>
  </div>`;
}

function referenceRatio(item: NutrientSummary): number {
  const reference = item.reference;
  if (!reference || reference.enabled === false || item.missing) return 0;
  const maximum = reference.type === "range"
    ? reference.max ?? reference.min
    : reference.type === "minimum"
      ? reference.min
      : reference.type === "upper"
        ? reference.max
        : reference.value;
  if (!maximum || maximum <= 0) return 0;
  return Math.min(1, Math.max(0, item.value / maximum));
}

function referenceText(item: NutrientSummary): string {
  const reference = item.reference;
  if (!reference || reference.enabled === false) return "No active reference";
  const value = reference.type === "range"
    ? `${formatNutritionValue(item.key, reference.min)}–${formatNutritionValue(item.key, reference.max)}`
    : formatNutritionValue(item.key, reference.value ?? reference.min ?? reference.max);
  const label = reference.label || ({ target: "target", minimum: "minimum", range: "reference range", upper: "upper reference", label: "label context" }[reference.type]);
  return `${value} ${item.unit} / ${label}`;
}

function renderReviewNutritionList(nutrients: Partial<NutrientValues>, basisQuantity = 1): string {
  const scale = Number.isFinite(basisQuantity) && basisQuantity > 0 ? basisQuantity : 1;
  return `<div class="review-nutrition-grid" data-review-nutrition>
    ${NUTRIENT_DEFINITIONS.map((definition) => {
      const value = nutrients[definition.key];
      const known = value !== null && value !== undefined;
      const displayValue = known ? Number(value) / scale : value;
      return `<div class="${known ? "" : "is-unknown"}"><span>${escapeHtml(definition.label)}</span><strong data-review-value="${escapeHtml(definition.key)}" data-base-value="${known ? displayValue : ""}" data-review-kind="${escapeHtml(definition.kind)}">${escapeHtml(formatNutritionValue(definition.key, displayValue))} <span>${escapeHtml(definition.unit)}</span></strong>${known ? "" : "<i>Unknown</i>"}</div>`;
    }).join("")}
  </div>`;
}

export function renderFoodCard(food: FoodRecord, href = `/review?foodId=${food.id}`): string {
  const initials = food.name.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  const source = food.source === "manual" ? "My food" : food.source || "Saved food";
  return `<article class="food-result food-card">
    <span class="food-avatar food-avatar--purple">${escapeHtml(initials)}</span>
    <span class="food-result-main"><strong>${escapeHtml(food.name)}</strong><span>${escapeHtml(source)} <span class="meta-divider">/</span> ${escapeHtml(food.quantityBasis)} <span class="meta-divider">/</span> ${escapeHtml(formatNutritionValue("calories", food.nutrients.calories))} kcal</span>${food.brand ? `<span>${escapeHtml(food.brand)}</span>` : ""}</span>
    <span class="food-result-actions"><a class="text-button" href="${escapeHtml(href)}">Review ${icon("arrow-right", "icon--tiny")}</a><form method="post" action="/foods/${food.id}/${food.favorite ? "unfavorite" : "favorite"}"><button class="text-button" type="submit">${food.favorite ? "Unfavorite" : "Favorite"}</button></form></span>
  </article>`;
}

export function renderMealCard(meal: MealRecord): string {
  const initials = meal.name.split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  return `<article class="food-result food-card">
    <span class="food-avatar food-avatar--green">${escapeHtml(initials)}</span>
    <span class="food-result-main"><strong>${escapeHtml(meal.name)}</strong><span>${meal.favorite ? "Favorite meal" : "My meal"} <span class="meta-divider">/</span> ${meal.ingredients.length} ingredient${meal.ingredients.length === 1 ? "" : "s"} <span class="meta-divider">/</span> ${escapeHtml(formatNutritionValue("calories", meal.nutrients.calories))} kcal per unit</span></span>
    <span class="food-result-actions"><a class="text-button" href="/review?mealId=${meal.id}">Review ${icon("arrow-right", "icon--tiny")}</a><form method="post" action="/meals/${meal.id}/${meal.favorite ? "unfavorite" : "favorite"}"><button class="text-button" type="submit">${meal.favorite ? "Unfavorite" : "Favorite"}</button></form></span>
  </article>`;
}

export function renderFoodEntry(entry: FoodEntryRecord): string {
  const nutrition = entry.snapshot.nutrients;
  const sourceClass = entry.mealId ? "source-chip--saved" : entry.foodId ? "source-chip--manual" : "source-chip--candidate";
  const sourceLabel = entry.mealId ? "Saved meal" : entry.foodId ? "Saved food" : "Logged snapshot";
  return `<article class="entry-row">
    <div class="entry-time"><time datetime="${escapeHtml(entry.loggedAtUtc)}">${escapeHtml(entry.localTime || "")}</time><span>${escapeHtml(entry.mealTag || "Food entry")}</span></div>
    <div class="entry-main"><div class="entry-title-line"><h3>${escapeHtml(entry.title)}</h3><span class="source-chip ${sourceClass}">${escapeHtml(sourceLabel)}</span></div><p>${escapeHtml(entry.snapshot.quantity.display)} ${escapeHtml(entry.snapshot.quantity.unit)} <span class="meta-divider">/</span> logged locally</p></div>
    <div class="entry-calories"><strong>${escapeHtml(formatNutritionValue("calories", nutrition.calories))}</strong><span>kcal</span></div>
    <div class="entry-macros"><span><b>${escapeHtml(formatNutritionValue("protein", nutrition.protein))}</b> protein</span><span><b>${escapeHtml(formatNutritionValue("carbohydrates", nutrition.carbohydrates))}</b> carbs</span><span><b>${escapeHtml(formatNutritionValue("fat", nutrition.fat))}</b> fat</span></div>
    <div class="entry-actions"><button class="icon-button" type="button" aria-label="More actions for ${escapeHtml(entry.title)}" aria-expanded="false" data-entry-menu><span class="sr-only">More actions</span>${icon("more")}</button><div class="entry-menu" hidden><a href="/entries/${entry.id}/edit">${icon("edit")}Edit Food entry</a><form method="post" action="/entries/${entry.id}/delete" onsubmit="return confirm('Delete this Food entry?')"><button type="submit">${icon("trash")}Delete Food entry</button></form><form method="post" action="/entries/${entry.id}/favorite"><button type="submit">${icon("bookmark")}Save as Favorite</button></form></div></div>
  </article>`;
}

type ReviewProfile = Omit<FoodProfile, "nutrients"> & { nutrients: Partial<Record<NutrientKey, number | null>> };

export function renderReviewSurface(input: { title: string; profile: ReviewProfile; source: string; token?: string; foodId?: number; mealId?: number; error?: string; warnings?: string[]; timezone?: string }): string {
  const actionTarget = input.token ? `/review/candidate/${encodeURIComponent(input.token)}/add` : input.foodId ? `/review/food/${input.foodId}/add` : `/review/meal/${input.mealId}/add`;
  const saveTarget = input.token ? `/review/candidate/${encodeURIComponent(input.token)}/save` : input.foodId ? `/review/food/${input.foodId}/favorite` : `/review/meal/${input.mealId}/favorite`;
  const basis = input.profile.basisQuantity ? `${input.profile.basisQuantity} ${input.profile.quantityBasis}` : input.profile.quantityBasis;
  const nutrientFields = NUTRIENT_DEFINITIONS.map((definition) => `<label>${escapeHtml(definition.label)} (${escapeHtml(definition.unit)}) <input name="${escapeHtml(definition.key)}" value="${escapeHtml(input.profile.nutrients[definition.key])}" inputmode="decimal" ${definition.key === "calories" ? "required" : ""}></label>`).join("");
  const reviewDate = localDate(input.timezone);
  const reviewTime = localTime(input.timezone);
  const sourceClass = input.token ? "source-chip--candidate" : "source-chip--saved";
  const sourceNote = input.token ? "Candidate values remain editable until you confirm" : "Confirmed definition; historical snapshots stay stable";
  return `<section class="review-panel review-surface" aria-labelledby="review-heading">
    <div class="review-source"><span class="source-chip ${sourceClass}">${escapeHtml(input.source)}</span><span>${escapeHtml(sourceNote)}</span></div>
    <h1 id="review-heading">${escapeHtml(input.title)}</h1>
    ${input.profile.brand ? `<p class="review-brand">${escapeHtml(input.profile.brand)}</p>` : ""}
    ${input.profile.description ? `<p class="review-description">${escapeHtml(input.profile.description)}</p>` : ""}
    <div class="review-quantity"><div><p class="section-kicker">Quantity</p><p>Declared basis: ${escapeHtml(basis)}</p></div><label class="quantity-control"><span class="sr-only">Quantity</span><input name="quantity" form="review-add" value="1" inputmode="decimal" data-review-quantity required><span>${escapeHtml(input.profile.quantityBasis)}</span></label></div>
    <section class="review-nutrition"><div class="review-nutrition-heading"><h3>Nutrition per basis</h3><span>Unknown values stay unknown</span></div>${renderReviewNutritionList(input.profile.nutrients, input.profile.basisQuantity)}</section>
    ${input.error ? `<p class="notice notice--error" role="alert">${escapeHtml(input.error)}</p>` : ""}
    ${(input.warnings ?? []).map((warning) => `<div class="review-warning" role="status"><span class="warning-mark">!</span><div><strong>Review required</strong><p>${escapeHtml(warning)}</p></div></div>`).join("")}
    <details class="review-details"><summary>Edit candidate values</summary><p>Correct the name, declared basis, or visible nutrition before confirming. Missing values are not inferred.</p><div class="stack-form"><label>Name <input form="review-add" name="name" value="${escapeHtml(input.profile.name)}" required></label><label>Declared quantity basis <input form="review-add" name="quantityBasis" value="${escapeHtml(input.profile.quantityBasis)}" required></label><div class="form-grid">${nutrientFields.replaceAll("<input ", "<input form=\"review-add\" ")}</div></div></details>
    <form id="review-add" method="post" action="${escapeHtml(actionTarget)}" class="review-form">
      <div class="review-meta-grid"><label>Local date <input name="date" type="date" value="${escapeHtml(reviewDate)}" required></label><label>Local time <input name="time" type="time" value="${escapeHtml(reviewTime)}" required></label><label>Meal tag <select name="mealTag"><option value="">No tag</option><option>Breakfast</option><option>Lunch</option><option>Dinner</option><option>Snack</option></select></label></div>
      <div class="review-actions"><button class="button button--primary" type="submit">${icon("check")}Add to Log</button><button class="button button--secondary" type="submit" formaction="${escapeHtml(saveTarget)}">${icon("bookmark")}${input.mealId ? "Favorite Meal" : "Save to Saved Foods"}</button></div>
    </form>
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

export function renderPage(input: { title: string; content: string; active?: "log" | "database" | "saved" | "targets" | "scan"; notice?: string; seedTimezone?: boolean }): string {
  const active = input.active || "log";
  const viewMeta = {
    log: { title: "Today’s log", description: "A clear record of what you have eaten so far." },
    database: { title: "Food Database", description: "Find a confirmed Food, then review the amount you actually consumed." },
    saved: { title: "Saved Foods", description: "Your reusable Foods, Favorites, and one-unit Meals." },
    scan: { title: "Scan Food", description: "Capture first. Review every proposal before it becomes part of your log." },
    targets: { title: "Daily Targets", description: "Optional references that stay under your control." },
  }[active];
  const navItem = (key: typeof active, href: string, label: string, iconName: string, shortcut = "") => `<a class="nav-item ${active === key ? "is-active" : ""}" href="${href}"${active === key ? ` aria-current="page"` : ""}>${icon(iconName)}<span>${label}</span>${shortcut ? `<span class="nav-key">${shortcut}</span>` : ""}</a>`;
  const mobileItem = (key: typeof active, href: string, label: string, iconName: string) => `<a class="mobile-nav-item ${active === key ? "is-active" : ""}" href="${href}"${active === key ? ` aria-current="page"` : ""}>${icon(iconName)}<span>${label}</span></a>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="theme-color" content="#0b1020"><title>${escapeHtml(input.title)} / Calories</title><link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600;700&family=IBM+Plex+Mono:wght@500;600&display=swap" rel="stylesheet"><link rel="stylesheet" href="/styles.css"><script src="https://unpkg.com/htmx.org@2.0.4"></script><script src="/review.js" defer></script>${input.seedTimezone ? `<script src="/timezone-seed.js" defer></script>` : ""}</head><body>
    ${ICON_SPRITE}
    <div class="app-shell">
      <aside class="sidebar" aria-label="Primary navigation">
        <a class="brand-lockup" href="/log"><span class="brand-mark">${icon("logo", "icon--logo")}</span><span class="brand-name">Calories<span class="brand-subtitle">personal food log</span></span></a>
        <p class="nav-label">Workspace</p>
        <nav class="primary-nav">${navItem("log", "/log", "Log", "log", "01")}${navItem("database", "/database", "Food Database", "search", "02")}${navItem("saved", "/saved-foods", "Saved Foods", "bookmark", "03")}</nav>
        <div class="sidebar-spacer"></div>
        <div class="sidebar-footer">${navItem("targets", "/targets", "Daily Targets", "settings")}<div class="instance-status"><span class="status-dot"></span><span>Local instance</span><span class="status-live">ready</span></div></div>
      </aside>
      <div class="app-main">
        <header class="mobile-header"><a class="brand-lockup brand-lockup--mobile" href="/log"><span class="brand-mark">${icon("logo", "icon--logo")}</span><span class="brand-name">Calories</span></a><a class="icon-button" href="/targets" aria-label="Open Daily Targets">${icon("help")}</a></header>
        <main class="workspace">
          <header class="workspace-header"><div><div class="title-line"><h1>${escapeHtml(viewMeta.title)}</h1><span class="mock-pill">local instance</span></div><p>${escapeHtml(viewMeta.description)}</p></div><div class="header-actions"><a class="icon-button" href="/targets" aria-label="Open Daily Targets">${icon("help")}</a><span class="avatar" aria-label="Local user">DA</span></div></header>
          <div class="view-stack"><div class="content">${input.notice ? `<p class="notice notice--success" role="status">${escapeHtml(input.notice)}</p>` : ""}${input.content}</div></div>
        </main>
      </div>
      <nav class="mobile-nav" aria-label="Mobile navigation">${mobileItem("log", "/log", "Log", "log")}${mobileItem("database", "/database", "Database", "search")}<a class="mobile-nav-item mobile-nav-item--add" href="/database" aria-label="Add Food"><span>${icon("plus")}</span></a>${mobileItem("saved", "/saved-foods", "Saved", "bookmark")}${mobileItem("targets", "/targets", "Targets", "settings")}</nav>
    </div>
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
