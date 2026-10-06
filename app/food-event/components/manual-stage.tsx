import { useState } from "react";
import { Link } from "react-router";

import eventStyles from "../food-event.module.css";
import { addFoodHref, FOOD_EVENT_FETCHERS } from "../links";
import {
  FoodFormActions,
  FoodNameField,
  FoodNutritionInputs,
  useFoodEventFetcher,
  type NutrientFieldValues,
} from "./food-fields";

/**
 * A food entered by hand: the nutrition is the total for the quantity eaten. A rejected save
 * keeps everything typed, since the form stays mounted while its fetcher submits.
 */
export function ManualStage({ csrfToken, date }: { csrfToken: string; date: string }) {
  const fetcher = useFoodEventFetcher(FOOD_EVENT_FETCHERS.add);
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [saveAsFavorite, setSaveAsFavorite] = useState(true);
  const [nutrients, setNutrients] = useState<NutrientFieldValues>({
    carbohydrateGrams: "",
    energyKcal: "",
    fatGrams: "",
    fiberGrams: "",
    proteinGrams: "",
    sodiumMilligrams: "",
    sugarGrams: "",
  });
  const pending = fetcher.state !== "idle";

  return (
    <section aria-labelledby="manual-food-title">
      <Link className={eventStyles.backToResults} to={addFoodHref(date, "choose")}>
        ‹ Back to methods
      </Link>
      <div className={eventStyles.foodIdentity}>
        <span className={eventStyles.catalogType}>Manual</span>
        <h3 id="manual-food-title">Add food manually</h3>
        <p>Enter the total nutrition for the quantity you ate.</p>
      </div>
      <fetcher.Form action="/food-events" className={eventStyles.editFoodForm} method="post" noValidate>
        <input name="csrfToken" type="hidden" value={csrfToken} />
        <input name="intent" type="hidden" value="log" />
        <input name="method" type="hidden" value="manual" />
        <input name="date" type="hidden" value={date} />
        <fieldset disabled={pending}>
          <FoodNameField value={name} onChange={setName} />
          <div className={eventStyles.editNutritionGrid}>
            <div className={eventStyles.stackedField}>
              <span>Measurement</span>
              <strong className={eventStyles.readOnlyMeasurement}>1 serving</strong>
              <small>Serving values are used without weight conversion.</small>
            </div>
            <label className={eventStyles.stackedField}>
              <span>Quantity</span>
              <input
                inputMode="decimal"
                max="99"
                min="0.000001"
                name="quantity"
                onChange={(event) => setQuantity(event.target.value)}
                required
                step="0.000001"
                type="number"
                value={quantity}
              />
            </label>
          </div>
          <FoodNutritionInputs
            fields={nutrients}
            onChange={(field, value) => setNutrients((current) => ({ ...current, [field]: value }))}
            required={(field) => field === "energyKcal"}
          />
          <p className={eventStyles.authoritativeNote}>
            Nutrition is the total for this quantity. Changing quantity here
            does not change the values you entered.
          </p>
          <label className={eventStyles.checkboxField}>
            <input
              checked={saveAsFavorite}
              name="saveAsFavorite"
              onChange={(event) => setSaveAsFavorite(event.target.checked)}
              type="checkbox"
            />
            <span>Save to My foods</span>
          </label>
          <FoodFormActions date={date} message={fetcher.data?.message}>
            <button className={eventStyles.primaryButton} type="submit">
              {pending ? "Adding…" : "Add to Food Log"}
            </button>
          </FoodFormActions>
        </fieldset>
      </fetcher.Form>
    </section>
  );
}
