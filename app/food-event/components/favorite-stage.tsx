import { Form, Link } from "react-router";

import eventStyles from "../food-event.module.css";
import { formatLocalDate } from "../../shared/local-date";
import type { AddFoodStage, Favorite } from "../food-event.model";
import { formatEnergy } from "../format";
import { addFoodHref } from "../links";
import { NUTRIENT_FIELDS, nutrientToDecimal } from "../nutrition";
import { FoodFormActions } from "./food-fields";
import { useAddFoodDraft, useAddFoodFetcher } from "./add-food-session";

export function FavoriteResults({
  date,
  favorites,
  origin = "my",
  query,
}: {
  date: string;
  favorites: Favorite[];
  origin?: "my" | "search";
  query: string;
}) {
  return (
    <div className={eventStyles.catalogResults} aria-label="My foods results">
      {favorites.map((favorite) => (
        <Link key={favorite.id} to={addFoodHref(date, `saved:${favorite.id}`, query, undefined, origin)}>
          <span>
            <strong>{favorite.name}</strong>
            <small>
              {favorite.snapshot.measurement.label} × {favorite.snapshot.quantityMicrounits / 1_000_000}
              {" · "}{formatEnergy(favorite.snapshot.nutrients.energyMilliKcal)} kcal
            </small>
          </span>
          <small>Select ›</small>
        </Link>
      ))}
    </div>
  );
}

/** My foods: browse and search the manual foods saved for reuse. */
export function FavoritesStage({
  date,
  stage,
}: {
  date: string;
  stage: Extract<AddFoodStage, { mode: "my" }>;
}) {
  const [query, setQuery] = useAddFoodDraft(`my:query:${stage.query}`, stage.query);
  return (
    <section aria-labelledby="my-foods-title">
      <div className={eventStyles.foodIdentity}>
        <span className={eventStyles.catalogType}>Manual foods</span>
        <h3 id="my-foods-title">My foods</h3>
        <p>Reuse a food you entered manually.</p>
      </div>
      <Form className={eventStyles.searchForm} method="get">
        <input name="date" type="hidden" value={date} />
        <input name="food" type="hidden" value="my" />
        <label htmlFor="my-food-query">Search My foods</label>
        <div className={eventStyles.searchControl}>
          <input
            autoComplete="off"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            id="my-food-query"
            name="query"
            placeholder="Try Mexican tortilla"
            type="search"
          />
          <button className={eventStyles.primaryButton} type="submit">Search</button>
        </div>
      </Form>
      {stage.favorites.length ? (
        <FavoriteResults date={date} favorites={stage.favorites} query={stage.query} />
      ) : (
        <div className={eventStyles.catalogState} role="status">
          <h3>{stage.query ? "No matching foods" : "No foods saved yet"}</h3>
          <p>Save a manual food here when you add it, or open an older manual entry to add it here.</p>
        </div>
      )}
    </section>
  );
}

/** A favorite's recorded values, reviewed before adding it to the viewed day. */
export function FavoriteStage({
  csrfToken,
  date,
  stage,
}: {
  csrfToken: string;
  date: string;
  stage: Extract<AddFoodStage, { mode: "saved" }>;
}) {
  const { favorite } = stage;
  const fetcher = useAddFoodFetcher(`saved:${favorite.id}`);
  const pending = fetcher.state !== "idle";
  return (
    <section aria-labelledby="saved-food-title">
      <Link className={eventStyles.backToResults} to={addFoodHref(date, stage.origin ?? "my", stage.query)}>
        {stage.origin === "search" ? "‹ Back to results" : "‹ Back to My foods"}
      </Link>
      <div className={eventStyles.foodIdentity}>
        <span className={eventStyles.catalogType}>My foods</span>
        <h3 id="saved-food-title">{favorite.name}</h3>
        <p>
          Review the saved values before adding this food to{" "}
          {formatLocalDate(date, { day: "numeric", month: "long", weekday: "long", year: "numeric" })}.
        </p>
      </div>
      <div className={eventStyles.foodDetailGrid}>
        <div className={eventStyles.stackedField}>
          <span>Measurement</span>
          <strong>{favorite.snapshot.measurement.label}</strong>
        </div>
        <div className={eventStyles.stackedField}>
          <span>Quantity</span>
          <strong>{favorite.snapshot.quantityMicrounits / 1_000_000}</strong>
        </div>
      </div>
      <dl className={eventStyles.nutritionPreview}>
        {NUTRIENT_FIELDS.map(({ label, nutrient, wholeMilligrams }) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{nutrientToDecimal(favorite.snapshot.nutrients[nutrient], wholeMilligrams) || "Unknown"}</dd>
          </div>
        ))}
      </dl>
      <fetcher.Form action="/food-events" method="post">
        <input name="csrfToken" type="hidden" value={csrfToken} />
        <input name="intent" type="hidden" value="log" />
        <input name="method" type="hidden" value="favorite" />
        <input name="date" type="hidden" value={date} />
        <input name="favoriteId" type="hidden" value={favorite.id} />
        <FoodFormActions date={date} message={fetcher.message}>
          <button className={eventStyles.primaryButton} disabled={pending} type="submit">
            {pending ? "Adding…" : "Add to Food Log"}
          </button>
        </FoodFormActions>
      </fetcher.Form>
    </section>
  );
}
