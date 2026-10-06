import { useState } from "react";
import { Link, useNavigation } from "react-router";

import { BarcodeSetupPopup } from "../../barcode";
import styles from "../../food-log.module.css";
import eventStyles from "../food-event.module.css";
import { DialogBackdrop, useModalDialog } from "../../shared/modal-dialog";
import { UiIcon } from "../../ui-icon";
import type { AddFoodStage, BarcodeLookupAccess } from "../food-event.model";
import { addFoodHref, addFoodRoute, foodLogHref } from "../links";
import methodStyles from "./add-food-method.module.css";
import { BarcodeDetailStage, BarcodeStage } from "./barcode-stage";
import { FavoritesStage, FavoriteStage } from "./favorite-stage";
import { FoodDetailSkeleton } from "./food-fields";
import { LookupDetailStage, LookupSearchStage } from "./lookup-stage";
import { ManualStage } from "./manual-stage";

/** The four ways to add food, as a list of rows. */
function MethodChoice({
  barcodeLookup,
  date,
}: {
  barcodeLookup: BarcodeLookupAccess;
  date: string;
}) {
  const [setupOpen, setSetupOpen] = useState(false);
  const scanBarcode = (
    <>
      <span className={methodStyles.icon}>
        <UiIcon name="barcode" />
      </span>
      <span className={methodStyles.label}>Scan barcode</span>
    </>
  );
  return (
    <>
      <div className={methodStyles.methods} aria-label="Add Food methods">
        <Link className={methodStyles.method} to={addFoodHref(date, "my")}>
          <span className={methodStyles.icon}>
            <UiIcon name="utensils" />
          </span>
          <span className={methodStyles.label}>My foods</span>
        </Link>
        <Link aria-label="Search for food" className={methodStyles.method} to={addFoodHref(date, "search")}>
          <span className={methodStyles.icon}>
            <UiIcon name="search" />
          </span>
          <span className={methodStyles.label}>Search food</span>
        </Link>
        {barcodeLookup === "enabled" ? (
          <Link className={methodStyles.method} to={addFoodHref(date, "barcode")}>
            {scanBarcode}
          </Link>
        ) : barcodeLookup === "admin-setup" ? (
          <button
            aria-haspopup="dialog"
            className={methodStyles.method}
            onClick={() => setSetupOpen(true)}
            type="button"
          >
            {scanBarcode}
          </button>
        ) : null}
        <Link className={methodStyles.method} to={addFoodHref(date, "manual")}>
          <span className={methodStyles.icon}>
            <UiIcon name="pencil" />
          </span>
          <span className={methodStyles.label}>Manual</span>
        </Link>
      </div>
      {setupOpen ? <BarcodeSetupPopup onClose={() => setSetupOpen(false)} /> : null}
    </>
  );
}

function stageChip(stage: AddFoodStage): string {
  switch (stage.mode) {
    case "search":
    case "detail":
      return "USDA food catalog";
    case "my":
    case "saved":
      return "My foods";
    case "barcode":
      return "Open Food Facts";
    default:
      return "Manual";
  }
}

/**
 * Add Food: choose a method, find or enter the food, and review it before saving to `date`.
 * Saves post to `/food-events` with a fetcher, so a refusal shows in the stage that was submitted.
 * While a catalog save is pending, Home shows its pending row and the dialog stays mounted but
 * hidden, so a refusal can reappear with what was chosen.
 */
export function AddFoodDialog({
  barcodeLookup,
  csrfToken,
  date,
  hidden = false,
  stage,
}: {
  barcodeLookup: BarcodeLookupAccess;
  csrfToken: string;
  date: string;
  hidden?: boolean;
  stage: AddFoodStage;
}) {
  const navigation = useNavigation();
  const search = new URLSearchParams(navigation.location?.search);
  const pendingRoute = addFoodRoute(search.get("food"), search.get("provider"));
  const detailPending =
    stage.mode === "search" &&
    (pendingRoute?.mode === "detail" || pendingRoute?.mode === "saved");
  const searchPending = navigation.state !== "idle" && !detailPending;
  const barcodePending = pendingRoute?.mode === "barcode";
  const navigationPending = navigation.state !== "idle";
  const closeHref = foodLogHref(date);
  const initialFocusSelector =
    stage.mode === "manual"
      ? 'input[name="name"]:not([disabled])'
      : 'input:not([type="hidden"]):not([disabled]), button:not([disabled]), select:not([disabled]), a[href]';
  const { closeDialog, dialogRef, handleDialogKeyDown } = useModalDialog({
    closeHref,
    initialFocusSelector,
    restoreFocusSelector: "[data-food-dialog-trigger]",
  });
  return (
    <div hidden={hidden}>
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
              {stage.mode !== "choose" ? (
                <>
                  <span className={eventStyles.dialogChip}>{stageChip(stage)}</span>
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
          ) : stage.mode === "detail" && stage.food.provider === "open-food-facts" ? (
            <BarcodeDetailStage
              backHref={addFoodHref(date, "search", stage.query)}
              backLabel="‹ Back to results"
              csrfToken={csrfToken}
              date={date}
              food={stage.food}
              key={stage.food.providerFoodId}
            />
          ) : stage.mode === "detail" ? (
            <LookupDetailStage
              csrfToken={csrfToken}
              date={date}
              food={stage.food}
              key={stage.food.providerFoodId}
              query={stage.query}
            />
          ) : stage.mode === "choose" ? (
            <MethodChoice barcodeLookup={barcodeLookup} date={date} />
          ) : stage.mode === "my" ? (
            <FavoritesStage date={date} stage={stage} />
          ) : stage.mode === "saved" ? (
            <FavoriteStage csrfToken={csrfToken} date={date} key={stage.favorite.id} stage={stage} />
          ) : stage.mode === "manual" ? (
            <ManualStage csrfToken={csrfToken} date={date} />
          ) : stage.mode === "barcode" ? (
            <BarcodeStage
              csrfToken={csrfToken}
              date={date}
              key={stage.barcode}
              navigationPending={navigationPending}
              pending={barcodePending}
              stage={stage}
            />
          ) : (
            <LookupSearchStage date={date} key={stage.query} pending={searchPending} stage={stage} />
          )}
        </section>
      </DialogBackdrop>
    </div>
  );
}
