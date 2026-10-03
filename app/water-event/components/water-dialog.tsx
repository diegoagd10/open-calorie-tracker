import { useState, type KeyboardEventHandler, type Ref } from "react";
import { Link, useFetcher } from "react-router";

import type { WaterEvent } from "../water-event.model";
import foodLogStyles from "../../food-log.module.css";
import styles from "../water-event.module.css";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_amount: "Enter an amount from 0.001 to 500 fl oz, with at most three decimals.",
  invalid_log_date: "Enter when the water was consumed; it cannot be in the future.",
};

/** The dialog message for a rejected save's error code, or undefined when nothing was rejected. */
function waterDialogError(code: string | undefined): string | undefined {
  return code === undefined ? undefined : (ERROR_MESSAGES[code] ?? "The water amount could not be saved.");
}

/** Creates a Water Event with its consumption time, or edits only an existing event's amount. */
export function WaterDialog(props: {
  actionHref: string;
  closeHref: string;
  csrfToken: string;
  /** The modal container's ref and key handler, which own focus, Escape, and focus restoration. */
  dialogRef?: Ref<HTMLElement>;
  event?: Pick<WaterEvent, "id" | "ounces">;
  initialLocalLogDate: string;
  /** The account's current wall-clock time, the latest consumption time the browser accepts. */
  maxLocalLogDate: string;
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
  returnDate: string;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { actionHref, closeHref, csrfToken, dialogRef, event, initialLocalLogDate, maxLocalLogDate, onKeyDown, returnDate } = props;
  // A fetcher keeps the dialog mounted, so a rejected save shows its error beside what was typed.
  const fetcher = useFetcher<{ error: string }>();
  const pendingIntent = fetcher.state === "idle" ? undefined : fetcher.formData?.get("intent");
  const error = waterDialogError(fetcher.data?.error);
  return (
    <section
      aria-labelledby="water-dialog-title"
      aria-modal="true"
      className={`${foodLogStyles.foodDialog} ${styles.dialog}`}
      onKeyDown={onKeyDown}
      ref={dialogRef}
      role="dialog"
    >
      <div className={foodLogStyles.dialogHead}>
        <div>
          <h2 id="water-dialog-title">{event ? "Edit Water Event" : "Add Water"}</h2>
          <p>{event ? "Change the amount" : "Record when and how much water you drank"}</p>
        </div>
        <Link aria-label="Close water dialog" className={foodLogStyles.dialogClose} to={closeHref}>×</Link>
      </div>
      <fetcher.Form action={actionHref} className={styles.form} method="post">
        <input name="csrfToken" type="hidden" value={csrfToken} />
        <input name="returnDate" type="hidden" value={returnDate} />
        <input name="intent" type="hidden" value="save" />
        <fieldset disabled={pendingIntent !== undefined}>
          {event ? <input name="id" type="hidden" value={event.id} /> : (
            <label className={styles.field}>Consumed at
              <input defaultValue={initialLocalLogDate} max={maxLocalLogDate} name="localLogDate" required type="datetime-local" />
            </label>
          )}
          <label className={styles.field}>Amount (fl oz)
            <input
              defaultValue={event?.ounces ?? ""}
              inputMode="decimal"
              max="500"
              min="0.001"
              name="ounces"
              required
              step="0.001"
              type="number"
            />
          </label>
          {error ? <p className={foodLogStyles.catalogError} role="alert">{error}</p> : null}
          <div className={styles.actions}>
            {event ? (
              <button className={foodLogStyles.dangerButton} onClick={() => setConfirmDelete(true)} type="button">
                Delete
              </button>
            ) : <span />}
            <div>
              <Link className={foodLogStyles.secondaryButton} to={closeHref}>Cancel</Link>
              <button className={styles.submitButton} type="submit">
                {pendingIntent === "save" ? "Saving…" : event ? "Save amount" : "Add water"}
              </button>
            </div>
          </div>
        </fieldset>
      </fetcher.Form>
      {event && confirmDelete ? (
        <fetcher.Form action={actionHref} className={`${foodLogStyles.deleteConfirm} ${styles.deleteConfirm}`} method="post">
          <input name="csrfToken" type="hidden" value={csrfToken} />
          <input name="returnDate" type="hidden" value={returnDate} />
          <input name="intent" type="hidden" value="delete" />
          <input name="eventIds" type="hidden" value={event.id} />
          <div role="alert">
            <strong>Delete this Water Event?</strong>
            <p>The daily water total will decrease by this amount.</p>
          </div>
          <button className={foodLogStyles.secondaryButton} onClick={() => setConfirmDelete(false)} type="button">
            Keep it
          </button>
          <button className={foodLogStyles.dangerSubmitButton} type="submit">
            {pendingIntent === "delete" ? "Deleting…" : "Confirm delete"}
          </button>
        </fetcher.Form>
      ) : null}
    </section>
  );
}
