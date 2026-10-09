import { useEffect, useRef, useState } from "react";
import { Link, useFetcher, useNavigation } from "react-router";

import { BarcodeSetupPopup } from "../../barcode";
import styles from "../../food-log.module.css";
import eventStyles from "../food-event.module.css";
import { DialogBackdrop, useModalDialog } from "../../shared/modal-dialog";
import { UiIcon } from "../../ui-icon";
import type { AddFoodStage, BarcodeLookupAccess } from "../food-event.model";
import { addFoodHref, addFoodRoute, barcodeHref, foodLogHref, FOOD_EVENT_FETCHERS } from "../links";
import { AddFoodSession, useAddFoodDraft, useMethodHref, type AddFoodMethod, type MethodHrefs } from "./add-food-session";
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
  const myHref = useMethodHref(date, "my");
  const searchHref = useMethodHref(date, "search");
  const barcodeMethodHref = useMethodHref(date, "barcode");
  const manualHref = useMethodHref(date, "manual");
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
        <Link className={methodStyles.method} to={myHref}>
          <span className={methodStyles.icon}>
            <UiIcon name="utensils" />
          </span>
          <span className={methodStyles.label}>My foods</span>
        </Link>
        <Link aria-label="Search for food" className={methodStyles.method} to={searchHref}>
          <span className={methodStyles.icon}>
            <UiIcon name="search" />
          </span>
          <span className={methodStyles.label}>Search food</span>
        </Link>
        {barcodeLookup === "enabled" ? (
          <Link className={methodStyles.method} to={barcodeMethodHref}>
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
        <Link className={methodStyles.method} to={manualHref}>
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

type AddFoodDialogProps = {
  barcodeLookup: BarcodeLookupAccess;
  csrfToken: string;
  date: string;
  hidden?: boolean;
  stage: AddFoodStage;
};

/**
 * One Add Food session per open dialog and date. Catalog saves keep the dialog mounted but
 * hidden while Home shows the pending row; a refusal restores the submitted draft.
 */
export function AddFoodDialog(props: AddFoodDialogProps) {
  return <AddFoodSession key={props.date}><AddFoodDialogContent {...props} /></AddFoodSession>;
}

function stageLocation(date: string, stage: AddFoodStage): { method?: AddFoodMethod; href: string } {
  if (stage.mode === "detail") return { method: "search", href: addFoodHref(date, stage.food.providerFoodId, stage.query, stage.food.provider) };
  if (stage.mode === "saved") return { method: stage.origin ?? "my", href: addFoodHref(date, `saved:${stage.favorite.id}`, stage.query, undefined, stage.origin) };
  if (stage.mode === "barcode") return { method: "barcode", href: stage.barcode ? barcodeHref(date, stage.barcode) : addFoodHref(date, "barcode") };
  if (stage.mode === "search" || stage.mode === "my") return { method: stage.mode, href: addFoodHref(date, stage.mode, stage.query) };
  return { method: stage.mode === "manual" ? "manual" : undefined, href: addFoodHref(date, stage.mode) };
}

function AddFoodDialogContent({
  barcodeLookup,
  csrfToken,
  date,
  hidden = false,
  stage,
}: AddFoodDialogProps) {
  const [, setMethodHrefs] = useAddFoodDraft<MethodHrefs>("method-hrefs", {});
  const { method, href } = stageLocation(date, stage);
  useEffect(() => {
    if (method) setMethodHrefs((current) => current[method] === href ? current : { ...current, [method]: href });
  }, [href, method, setMethodHrefs]);
  const addFetcher = useFetcher({ key: FOOD_EVENT_FETCHERS.add });
  const saving = addFetcher.state !== "idle";
  const scrollPositions = useRef(new Map<string, number>());
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
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const dialog = dialogRef.current;
      const target = stage.mode === "choose"
        ? dialog?.querySelector<HTMLElement>('[aria-label="Close food search"]')
        : dialog?.querySelector<HTMLElement>('[data-food-stage] input:not([type="hidden"]):not([disabled])')
          ?? dialog?.querySelector<HTMLElement>('[data-food-stage] a[href]');
      target?.focus({ preventScroll: true });
      if (dialog) dialog.scrollTop = scrollPositions.current.get(href) ?? 0;
    });
    return () => cancelAnimationFrame(frame);
  }, [dialogRef, href, stage.mode]);
  return (
    <div hidden={hidden}>
      <DialogBackdrop onClose={closeDialog}>
        <section
          aria-labelledby="food-dialog-title"
          aria-modal="true"
          className={styles.foodDialog}
          onKeyDown={handleDialogKeyDown}
          onScroll={(event) => scrollPositions.current.set(href, event.currentTarget.scrollTop)}
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
          {stage.mode !== "choose" ? (
            <nav aria-label="Add Food navigation" className={eventStyles.methodNavigation}>
              <Link
                aria-disabled={saving || undefined}
                className={eventStyles.changeMethod}
                onClick={(event) => { if (saving) event.preventDefault(); }}
                to={addFoodHref(date, "choose")}
              >Change method</Link>
            </nav>
          ) : null}
          <div data-food-stage>
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
            <FavoritesStage date={date} key={stage.query} stage={stage} />
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
          </div>
        </section>
      </DialogBackdrop>
    </div>
  );
}
