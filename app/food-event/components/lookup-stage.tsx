import { useState } from "react";
import { Form, Link } from "react-router";

import type { CatalogFood } from "../../catalog/food-catalog.server";
import eventStyles from "../food-event.module.css";
import type { AddFoodStage } from "../food-event.model";
import { addFoodHref, catalogQuery, FOOD_EVENT_FETCHERS } from "../links";
import { FavoriteResults } from "./favorite-stage";
import { FoodFormActions, NutritionPreview, ProviderAttribution, useFoodEventFetcher } from "./food-fields";

const USDA = { href: "https://fdc.nal.usda.gov/", name: "USDA FoodData Central" };

/** USDA search with matching My foods; My foods stay listed when USDA is unavailable. */
export function LookupSearchStage({
  date,
  pending,
  stage,
}: {
  date: string;
  /** A search navigation is in flight. */
  pending: boolean;
  stage: Extract<AddFoodStage, { mode: "search" }>;
}) {
  const [clientSearchMessage, setClientSearchMessage] = useState<string>();
  const [searchQuery, setSearchQuery] = useState(stage.query);
  return (
    <>
      <Form
        className={eventStyles.searchForm}
        method="get"
        noValidate
        onSubmit={(event) => {
          if (catalogQuery(searchQuery) === undefined) {
            event.preventDefault();
            setClientSearchMessage(
              "Enter a trimmed food search from 2 to 100 characters.",
            );
          }
        }}
      >
        <input name="date" type="hidden" value={date} />
        <input name="food" type="hidden" value="search" />
        <label htmlFor="food-query">Search local foods</label>
        <div className={eventStyles.searchControl}>
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
          <button className={eventStyles.primaryButton} type="submit">
            Search
          </button>
        </div>
      </Form>
      {pending ? (
        <div className={eventStyles.catalogState} role="status">
          <h3>Searching USDA foods</h3>
          <p>Your deliberate catalog request is in progress.</p>
        </div>
      ) : clientSearchMessage ? (
        <div
          className={eventStyles.catalogState}
          id="food-search-error"
          role="alert"
        >
          <h3>Search not sent</h3>
          <p>{clientSearchMessage}</p>
        </div>
      ) : (
        <>
          {stage.favorites.length > 0 ? (
            <section aria-label="My foods">
              <h3>My foods</h3>
              <FavoriteResults date={date} favorites={stage.favorites} query={stage.query} />
            </section>
          ) : null}
          {stage.message ? (
            <div className={eventStyles.catalogState} role="alert">
              <h3>{stage.title ?? "Search unavailable"}</h3>
              <p>{stage.message}</p>
            </div>
          ) : null}
          {stage.results.length > 0 ? (
            <div
              className={eventStyles.catalogResults}
              aria-label="Food search results"
            >
              {stage.results.map((result) => {
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
                    to={addFoodHref(
                      date,
                      result.providerFoodId,
                      stage.query,
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
          ) : stage.message || stage.favorites.length ? null : stage.query ? (
            <div className={eventStyles.catalogState} role="status">
              <h3>No foods found</h3>
              <p>
                Try a broader product or ingredient name. Your Food Log
                was not changed.
              </p>
            </div>
          ) : (
            <div className={eventStyles.catalogState}>
              <h3>Find a food</h3>
              <p>
                Search ingredients from USDA Foundation.
              </p>
            </div>
          )}
        </>
      )}
      <ProviderAttribution {...USDA} />
    </>
  );
}

/** A USDA food's review: choose a provider-backed measurement and quantity, then save it. */
export function LookupDetailStage({
  csrfToken,
  date,
  food,
  query,
}: {
  csrfToken: string;
  date: string;
  food: CatalogFood;
  query: string;
}) {
  const fetcher = useFoodEventFetcher(FOOD_EVENT_FETCHERS.add);
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
        className={eventStyles.backToResults}
        to={addFoodHref(date, "search", query)}
      >
        ‹ Back to results
      </Link>
      <div className={eventStyles.foodIdentity}>
        <span className={eventStyles.catalogType}>{food.dataType}</span>
        <h3>{food.name}</h3>
        <p>
          USDA FoodData Central
          {food.brand ? ` · ${food.brand}` : ""}
        </p>
      </div>
      <div className={eventStyles.snapshotNote}>
        <span aria-hidden="true">◇</span>
        <p>
          <strong>Saved as a Nutrition Snapshot</strong>
          This entry keeps these values and source details if its catalog later
          changes or is unavailable.
        </p>
      </div>
      <fetcher.Form action="/food-events" className={eventStyles.logFoodForm} method="post">
        <input name="csrfToken" type="hidden" value={csrfToken} />
        <input name="intent" type="hidden" value="log" />
        <input name="method" type="hidden" value="lookup" />
        <input name="date" type="hidden" value={date} />
        <input name="providerFoodId" type="hidden" value={food.providerFoodId} />
        <input name="reviewVersion" type="hidden" value={food.catalogGeneration ?? ""} />
        <div className={eventStyles.foodDetailGrid}>
          <label className={eventStyles.stackedField}>
            <span>Measurement</span>
            <select
              name="measurementId"
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
          <label className={eventStyles.stackedField}>
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
        <NutritionPreview food={food} multiplier={multiplier} />
        <FoodFormActions date={date} message={fetcher.data?.message}>
          <button className={eventStyles.primaryButton} disabled={fetcher.state !== "idle"} type="submit">
            Add to Food Log
          </button>
        </FoodFormActions>
      </fetcher.Form>
    </>
  );
}
