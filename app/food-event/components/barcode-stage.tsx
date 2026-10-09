import { useState } from "react";
import { Form, Link, useNavigate } from "react-router";

import { BarcodeCameraScanner } from "../../barcode";
import type { CatalogFood } from "../../catalog/food-catalog.server";
import styles from "../../food-log.module.css";
import eventStyles from "../food-event.module.css";
import type { AddFoodStage } from "../food-event.model";
import { addFoodHref, barcodeHref, catalogBarcode } from "../links";
import { quantityMicrounitsFromDecimal } from "../nutrition";
import { FoodFormActions, NutritionPreview, ProviderAttribution } from "./food-fields";
import { ManualEntryLink, useAddFoodDraft, useAddFoodFetcher, useMethodHref } from "./add-food-session";

const OPEN_FOOD_FACTS = { href: "https://world.openfoodfacts.org/", name: "Open Food Facts" };

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

/** An Open Food Facts product's review: its label nutrition for a supported measure and quantity. */
export function BarcodeDetailStage({
  backHref,
  backLabel,
  csrfToken,
  date,
  food,
}: {
  backHref: string;
  backLabel: string;
  csrfToken: string;
  date: string;
  food: CatalogFood;
}) {
  const draftKey = `${food.provider}:${food.providerFoodId}`;
  const fetcher = useAddFoodFetcher(draftKey);
  const [quantity, setQuantity] = useAddFoodDraft(`${draftKey}:quantity`, "1");
  const [measurementId, setMeasurementId] = useAddFoodDraft(`${draftKey}:measurement`, food.measurements[0]?.id ?? "");
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
        className={eventStyles.backToResults}
        to={backHref}
      >
        {backLabel}
      </Link>
      <div className={eventStyles.foodIdentity}>
        <span className={eventStyles.catalogType}>Open Food Facts</span>
        <h3 id="barcode-product-title">{displayName}</h3>
        <p>Barcode {food.barcode}</p>
        {food.brand ? <p>{food.brand}</p> : null}
      </div>
      <div className={eventStyles.snapshotNote}>
        <span aria-hidden="true">◇</span>
        <p>
          <strong>Saved as a Nutrition Snapshot</strong>
          Confirm to keep these nutrition values and source details locally if
          Open Food Facts later changes or is unavailable.
        </p>
      </div>
      <fetcher.Form action="/food-events" className={eventStyles.logFoodForm} method="post">
        <input name="csrfToken" type="hidden" value={csrfToken} />
        <input name="intent" type="hidden" value="log" />
        <input name="method" type="hidden" value="barcode" />
        <input name="date" type="hidden" value={date} />
        <input name="providerFoodId" type="hidden" value={food.providerFoodId} />
        <input name="reviewVersion" type="hidden" value={food.catalogGeneration ?? ""} />
        {!food.isSelectable ? <p role="alert" className={styles.catalogError}>{offCalculationMessage(food.calculationUnavailableReason)}</p> : null}
        <div className={eventStyles.foodDetailGrid}>
          <label className={eventStyles.stackedField}>
            <span>Measurement</span>
            <select aria-label="Measurement" name="measurementId" value={measurementId} onChange={event => setMeasurementId(event.currentTarget.value)} disabled={!food.isSelectable}>
              {food.measurements.map(value => <option key={value.id} value={value.id}>{value.label}</option>)}
            </select>
            <small>Nutrition uses the source's supported quantity and unit.</small>
          </label>
          <label className={eventStyles.stackedField}>
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
        {food.isSelectable ? <NutritionPreview
          carbohydrateLabel="Carbohydrates"
          food={food}
          includeAdditional
          multiplier={multiplier}
        /> : null}
        <FoodFormActions date={date} message={fetcher.message}>
          <ManualEntryLink date={date} message={fetcher.message} />
          <button
            className={eventStyles.primaryButton}
            disabled={!food.isSelectable || !measurement || quantityMicrounits === undefined || fetcher.state !== "idle"}
            type="submit"
          >
            Add to Food Log
          </button>
        </FoodFormActions>
      </fetcher.Form>
      <ProviderAttribution {...OPEN_FOOD_FACTS} />
    </section>
  );
}

/** Scan or type a barcode, then review the product Open Food Facts returns. */
export function BarcodeStage({
  csrfToken,
  date,
  navigationPending,
  pending,
  stage,
}: {
  csrfToken: string;
  date: string;
  /** Any navigation is in flight, so the camera should stop. */
  navigationPending: boolean;
  /** A barcode lookup navigation is in flight. */
  pending: boolean;
  stage: Extract<AddFoodStage, { mode: "barcode" }>;
}) {
  const navigate = useNavigate();
  const [barcode, setBarcode] = useAddFoodDraft("barcode:input", stage.barcode);
  const searchHref = useMethodHref(date, "search");
  const [clientMessage, setClientMessage] = useState<string>();
  const validBarcode = catalogBarcode(barcode);
  const scannerKey = stage.barcode || "new-scan";

  if (stage.food && !stage.message && !pending) {
    return (
      <BarcodeDetailStage
        backHref={addFoodHref(date, "barcode")}
        backLabel="‹ Back to scanner"
        csrfToken={csrfToken}
        date={date}
        food={stage.food}
      />
    );
  }

  return (
    <>
      <div className={eventStyles.dialogActions}>
        <Link className={eventStyles.backToResults} to={searchHref}>
          Search for food
        </Link>
      </div>
      <Form
        className={eventStyles.searchForm}
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
        <div className={eventStyles.searchControl}>
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
          <button className={eventStyles.primaryButton} type="submit">
            {stage.message && validBarcode ? "Retry" : "Look up"}
          </button>
        </div>
      </Form>
      <BarcodeCameraScanner
        key={scannerKey}
        onDetected={
          (detectedBarcode) => {
            setBarcode(detectedBarcode);
            setClientMessage(undefined);
            void navigate(barcodeHref(date, detectedBarcode));
          }
        }
        stopRequested={navigationPending}
      />
      {pending ? (
        <div className={eventStyles.catalogState} role="status">
          <h3>Checking Open Food Facts</h3>
          <p>Reviewing the entered barcode without changing your Food Log.</p>
        </div>
      ) : clientMessage ? (
        <div className={eventStyles.catalogState} id="barcode-input-error" role="alert">
          <h3>Barcode not valid</h3>
          <p>{clientMessage}</p>
        </div>
      ) : stage.message ? (
        <div className={eventStyles.catalogState} role="alert">
          <h3>{stage.title}</h3>
          <p>{stage.message}</p>
          <ManualEntryLink date={date} message={stage.message} />
        </div>
      ) : (
        <div className={eventStyles.catalogState}>
          <h3>Scan barcode</h3>
          <p>Type the digits printed below a commercial barcode to review it.</p>
        </div>
      )}
    </>
  );
}
