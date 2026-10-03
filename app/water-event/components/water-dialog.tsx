import { useState, type KeyboardEventHandler, type Ref } from "react";
import { Form, Link, useNavigation } from "react-router";

import type { WaterEvent } from "../water-event.model";
import foodLogStyles from "../../food-log.module.css";
import styles from "../water-event.module.css";

const ERROR_MESSAGES: Record<string, string> = {
  invalid_amount: "Enter an amount from 0.001 to 500 fl oz, with at most three decimals.",
  invalid_log_date: "Enter when the water was consumed; it cannot be in the future.",
};

/** The dialog message for a rejected save's error code, or undefined for none or an unknown code. */
export function waterDialogError(code: string | null): string | undefined {
  return code === null ? undefined : (ERROR_MESSAGES[code] ?? "The water amount could not be saved.");
}

/** Creates a Water Event with its consumption time, or edits only an existing event's amount. */
export function WaterDialog(props: {
  actionHref: string;
  closeHref: string;
  csrfToken: string;
  /** The modal container's ref and key handler, which own focus, Escape, and focus restoration. */
  dialogRef?: Ref<HTMLElement>;
  error?: string;
  event?: Pick<WaterEvent, "id" | "ounces">;
  initialLocalLogDate: string;
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
  returnDate: string;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { actionHref, closeHref, csrfToken, dialogRef, error, event, initialLocalLogDate, onKeyDown, returnDate } = props;
  const navigation = useNavigation();
  const pendingIntent = navigation.formAction === actionHref ? navigation.formData?.get("intent") : undefined;
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
      <Form action={actionHref} className={styles.form} method="post">
        <input name="csrfToken" type="hidden" value={csrfToken} />
        <input name="returnDate" type="hidden" value={returnDate} />
        <input name="intent" type="hidden" value="save" />
        <fieldset disabled={pendingIntent !== undefined}>
          {event ? <input name="id" type="hidden" value={event.id} /> : (
            <label className={styles.field}>Consumed at
              <input defaultValue={initialLocalLogDate} name="localLogDate" required type="datetime-local" />
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
      </Form>
      {event && confirmDelete ? (
        <Form action={actionHref} className={`${foodLogStyles.deleteConfirm} ${styles.deleteConfirm}`} method="post" role="alert">
          <input name="csrfToken" type="hidden" value={csrfToken} />
          <input name="returnDate" type="hidden" value={returnDate} />
          <input name="intent" type="hidden" value="delete" />
          <input name="eventIds" type="hidden" value={event.id} />
          <div>
            <strong>Delete this Water Event?</strong>
            <p>The daily water total will decrease by this amount.</p>
          </div>
          <button className={foodLogStyles.secondaryButton} onClick={() => setConfirmDelete(false)} type="button">
            Keep it
          </button>
          <button className={foodLogStyles.dangerSubmitButton} type="submit">
            {pendingIntent === "delete" ? "Deleting…" : "Confirm delete"}
          </button>
        </Form>
      ) : null}
    </section>
  );
}
