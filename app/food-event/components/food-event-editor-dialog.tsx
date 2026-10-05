import { useEffect, useState } from "react";
import { Link, useNavigate, type FetcherWithComponents } from "react-router";

import styles from "../../food-log.module.css";
import eventStyles from "../food-event.module.css";
import { DialogBackdrop, useModalDialog } from "../../shared/modal-dialog";
import { UiIcon } from "../../ui-icon";
import type { FoodEvent, FoodEventActionData } from "../food-event.model";
import { copyHref, FOOD_EVENT_FETCHERS, foodLogHref } from "../links";
import {
  NUTRIENT_FIELDS,
  nutrientToDecimal,
  quantityMicrounitsFromDecimal,
  scaleNutrients,
} from "../nutrition";
import {
  FoodNameField,
  FoodNutritionInputs,
  useFoodEventFetcher,
  type NutrientFieldValues,
} from "./food-fields";

type EditorFields = NutrientFieldValues & { name: string; quantity: string; measurementId: string };

function nutrientFields(nutrients: FoodEvent["nutrients"]): NutrientFieldValues {
  return Object.fromEntries(NUTRIENT_FIELDS.map(({ field, nutrient, wholeMilligrams }) => [
    field,
    nutrientToDecimal(nutrients[nutrient], wholeMilligrams),
  ])) as NutrientFieldValues;
}

function initialFields(event: FoodEvent): EditorFields {
  return {
    ...nutrientFields(event.nutrients),
    name: event.name,
    quantity: String(event.quantityMicrounits / 1_000_000),
    measurementId: event.measurement.id,
  };
}

/** Nutrients recalculated from the stored authority, never from previously rounded values. */
function rescaledFields(event: FoodEvent, measurementId: string, quantity: string): Partial<EditorFields> {
  const measurement = event.measurements.find((candidate) => candidate.id === measurementId);
  const quantityMicrounits = quantityMicrounitsFromDecimal(quantity);
  if (!measurement || quantityMicrounits === undefined) return {};
  return nutrientFields(scaleNutrients(event.authority, measurement, quantityMicrounits));
}

function CopyMenu({
  csrfToken,
  date,
  disabled,
  event,
}: {
  csrfToken: string;
  date: string;
  disabled: boolean;
  event: FoodEvent;
}) {
  const fetcher = useFoodEventFetcher(FOOD_EVENT_FETCHERS.copyToToday);
  const [open, setOpen] = useState(false);
  const copyPending = fetcher.state !== "idle";

  return (
    <div className={eventStyles.editorCopyMenu}>
      <button
        aria-expanded={open}
        aria-label="Copy entry"
        className={eventStyles.editIconButton}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        title="Copy entry"
        type="button"
      >
        <UiIcon name="copy" />
      </button>
      {open ? (
        <div className={eventStyles.editorCopyMenuPopover}>
          <fetcher.Form action="/food-events" method="post">
            <input name="csrfToken" type="hidden" value={csrfToken} />
            <input name="intent" type="hidden" value="copy" />
            <input name="id" type="hidden" value={event.id} />
            <input name="date" type="hidden" value={date} />
            <button disabled={disabled || copyPending} type="submit">
              {copyPending ? "Copying…" : "Copy to today"}
            </button>
          </fetcher.Form>
          <Link to={copyHref(date, event.id)}>
            Copy to another date…
          </Link>
          {fetcher.data?.message ? <p className={styles.catalogError} role="alert">{fetcher.data.message}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

function SaveToFavorites({ csrfToken, date, event }: { csrfToken: string; date: string; event: FoodEvent }) {
  const fetcher = useFoodEventFetcher(FOOD_EVENT_FETCHERS.addFavorite);
  if (event.favoriteId !== null) {
    return (
      <p className={eventStyles.authoritativeNote} role="status">
        In My foods. Changes to this daily entry do not change the saved food.
      </p>
    );
  }
  return (
    <fetcher.Form action="/food-events" method="post">
      <input name="csrfToken" type="hidden" value={csrfToken} />
      <input name="intent" type="hidden" value="add-favorite" />
      <input name="id" type="hidden" value={event.id} />
      <input name="date" type="hidden" value={date} />
      <button className={styles.secondaryButton} disabled={fetcher.state !== "idle"} type="submit">
        Add to My foods
      </button>
      {fetcher.data?.message ? <p className={styles.catalogError} role="alert">{fetcher.data.message}</p> : null}
    </fetcher.Form>
  );
}

/** The editor for one version of an event; it remounts when that version changes. */
function EditorForm({
  canCopy,
  csrfToken,
  date,
  event,
  fetcher,
}: {
  canCopy: boolean;
  csrfToken: string;
  date: string;
  event: FoodEvent;
  fetcher: FetcherWithComponents<FoodEventActionData>;
}) {
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [fields, setFields] = useState(() => initialFields(event));
  const closeHref = foodLogHref(date);
  const { closeDialog, dialogRef, handleDialogKeyDown } = useModalDialog({
    closeHref,
    initialFocusSelector: "input:not([disabled])",
    restoreFocusSelector: "[data-entry-editor-trigger]",
  });
  const pending = fetcher.state !== "idle";
  const pendingIntent = pending ? fetcher.formData?.get("intent") : undefined;
  const manual = event.source.provider === "manual";

  useEffect(() => {
    if (!confirmingDelete) return;
    const confirmDeleteButton = dialogRef.current?.querySelector<HTMLButtonElement>(
      'button[name="intent"][value="delete"]',
    );
    confirmDeleteButton?.focus({ preventScroll: true });
    confirmDeleteButton?.scrollIntoView?.({ block: "nearest" });
  }, [confirmingDelete, dialogRef]);

  function changeScale(measurementId: string, quantity: string) {
    setFields((current) => ({
      ...current,
      ...rescaledFields(event, measurementId, quantity),
      quantity,
      measurementId,
    }));
  }

  return (
    <DialogBackdrop onClose={closeDialog}>
      <section
        aria-labelledby="edit-food-entry-title"
        aria-modal="true"
        className={`${styles.foodDialog} ${eventStyles.editFoodDialog}`}
        onKeyDown={handleDialogKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <div className={`${styles.dialogHead} ${eventStyles.editDialogHead}`}>
          <div>
            <h2 id="edit-food-entry-title">Edit Food Entry</h2>
            <span className={eventStyles.dialogChip}>Nutrition Snapshot</span>
            <p>Changes affect this occurrence only.</p>
          </div>
          <div className={eventStyles.editHeaderActions}>
            {canCopy ? <CopyMenu csrfToken={csrfToken} date={date} disabled={pending} event={event} /> : null}
            <button
              aria-label="Delete entry"
              className={`${eventStyles.editIconButton} ${eventStyles.editDeleteButton}`}
              disabled={pending}
              onClick={() => setConfirmingDelete(true)}
              title="Delete entry"
              type="button"
            >
              <UiIcon name="delete" />
            </button>
            <Link
              aria-label="Cancel"
              className={eventStyles.editIconButton}
              title="Cancel"
              to={closeHref}
            >
              <UiIcon name="cancel" />
            </Link>
            <button
              aria-label={pendingIntent === "update" ? "Saving changes" : "Save changes"}
              className={`${eventStyles.editIconButton} ${eventStyles.editSaveButton}`}
              disabled={pending}
              form="food-entry-edit-form"
              name="intent"
              title={pendingIntent === "update" ? "Saving changes" : "Save changes"}
              type="submit"
              value="update"
            >
              <UiIcon name="save" />
            </button>
          </div>
        </div>
        {manual ? <SaveToFavorites csrfToken={csrfToken} date={date} event={event} /> : null}
        {confirmingDelete ? (
          <div className={`${styles.deleteConfirm} ${eventStyles.editDeleteConfirm}`} role="alert">
            <div>
              <strong>Delete this Food Entry?</strong>
              <p>Its nutrition will no longer contribute to this day.</p>
            </div>
            <button
              className={styles.secondaryButton}
              onClick={() => setConfirmingDelete(false)}
              type="button"
            >
              Keep it
            </button>
            <button
              className={styles.dangerSubmitButton}
              disabled={pending}
              form="food-entry-edit-form"
              formNoValidate
              name="intent"
              type="submit"
              value="delete"
            >
              {pendingIntent === "delete" ? "Deleting…" : "Delete"}
            </button>
          </div>
        ) : null}
        <fetcher.Form action="/food-events" className={eventStyles.editFoodForm} id="food-entry-edit-form" method="post" noValidate>
          <input name="csrfToken" type="hidden" value={csrfToken} />
          <input name="date" type="hidden" value={date} />
          <input name="id" type="hidden" value={event.id} />
          <input name="expectedUpdatedAt" type="hidden" value={event.updatedAt} />
          <fieldset disabled={pending}>
            <FoodNameField value={fields.name} onChange={name => setFields(current => ({ ...current, name }))} />
            <div className={eventStyles.foodDetailGrid}>
              <label className={eventStyles.stackedField}>
                <span>Measurement</span>
                <select
                  name="measurementId"
                  onChange={(change) => changeScale(change.target.value, fields.quantity)}
                  value={fields.measurementId}
                >
                  {event.measurements.map((measurement) => (
                    <option key={measurement.id} value={measurement.id}>
                      {measurement.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={eventStyles.stackedField}>
                <span>Quantity</span>
                <input
                  inputMode="decimal"
                  max="99"
                  min="0.000001"
                  name="quantity"
                  onChange={(change) => changeScale(fields.measurementId, change.target.value)}
                  required
                  step="0.000001"
                  type="number"
                  value={fields.quantity}
                />
              </label>
            </div>
            <FoodNutritionInputs
              fields={fields}
              onChange={(field, value) => setFields((current) => ({ ...current, [field]: value }))}
              required={(field) => manual && field === "energyKcal" ? true : undefined}
            />
            <p className={eventStyles.authoritativeNote}>
              Quantity and measurement recalculate from the saved authoritative
              base, not from previously rounded values. Empty nutrients save as
              unknown; zero remains a known zero.
            </p>
            {fetcher.data?.message ? (
              <p className={styles.catalogError} role="alert">
                {fetcher.data.message}
              </p>
            ) : null}
          </fieldset>
        </fetcher.Form>
      </section>
    </DialogBackdrop>
  );
}

/**
 * Edits or deletes one event, sending the version it shows. A conflict returns the current
 * version, so the form reloads with it and a retry sends that version, never the rejected one;
 * an event deleted elsewhere closes the editor back to its day.
 */
export function FoodEventEditorDialog({
  canCopy,
  csrfToken,
  date,
  event,
}: {
  canCopy: boolean;
  csrfToken: string;
  date: string;
  event: FoodEvent;
}) {
  const fetcher = useFoodEventFetcher(FOOD_EVENT_FETCHERS.edit);
  const navigate = useNavigate();
  const missing = fetcher.state === "idle" && fetcher.data?.code === "not_found";
  const current = fetcher.data?.code === "edit_conflict" && fetcher.data.event ? fetcher.data.event : event;

  useEffect(() => {
    if (missing) void navigate(foodLogHref(date));
  }, [date, missing, navigate]);

  return (
    <EditorForm
      canCopy={canCopy}
      csrfToken={csrfToken}
      date={date}
      event={current}
      fetcher={fetcher}
      key={current.updatedAt}
    />
  );
}
