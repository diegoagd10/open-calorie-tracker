import { useEffect, useRef, useState, type FormEvent, type KeyboardEventHandler, type Ref } from "react";
import { Link, useFetcher } from "react-router";

import type { WaterEvent } from "../water-event.model";
import { ounceThousandths, waterEventLocalDateTime } from "../water-event.utils";
import { zonedDateTimeToUtc } from "../../shared/date-time";
import { UiIcon } from "../../ui-icon";
import foodLogStyles from "../../food-log.module.css";
import styles from "../water-event.module.css";

const AMOUNT_PRESETS = ["8", "11", "16", "24"];
const ERROR_MESSAGES: Record<string, string> = {
  invalid_amount: "Enter an amount from 0.001 to 500 fl oz, with at most three decimals.",
  invalid_log_date: "The consumption time could not be recorded. Please reopen the dialog and try again.",
};

/** The dialog message for a rejected save's error code, or undefined when nothing was rejected. */
function waterDialogError(code: string | undefined): string | undefined {
  return code === undefined ? undefined : (ERROR_MESSAGES[code] ?? "The water amount could not be saved.");
}

/** Creates a Water Event with an automatic consumption time, or edits only its amount. */
export function WaterDialog(props: {
  actionHref: string;
  closeHref: string;
  csrfToken: string;
  /** The modal container's ref and key handler, which own focus, Escape, and focus restoration. */
  dialogRef?: Ref<HTMLElement>;
  event?: Pick<WaterEvent, "id" | "ounces">;
  initialLocalLogDate: string;
  /** The account's current wall-clock time, used to anchor the automatic consumption time. */
  maxLocalLogDate: string;
  onKeyDown?: KeyboardEventHandler<HTMLElement>;
  returnDate: string;
  timeZone: string;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { actionHref, closeHref, csrfToken, dialogRef, event, initialLocalLogDate, maxLocalLogDate, onKeyDown, returnDate, timeZone } = props;
  const [selectedAmount, setSelectedAmount] = useState(() => event
    ? AMOUNT_PRESETS.includes(event.ounces) ? event.ounces : "custom"
    : "");
  const [customAmount, setCustomAmount] = useState(event?.ounces ?? "");
  const amountInputRef = useRef<HTMLInputElement>(null);
  const previousAmountRef = useRef(selectedAmount);
  const [clock] = useState(() => ({
    instant: Date.parse(zonedDateTimeToUtc(maxLocalLogDate, timeZone)!),
    startedAt: performance.now(),
  }));
  const ounces = selectedAmount === "custom" ? customAmount : selectedAmount;
  const thousandths = ounceThousandths(ounces);
  const validAmount = thousandths !== null && thousandths >= 1n && thousandths <= 500_000n;
  // A fetcher keeps the dialog mounted, so a rejected save shows its error beside what was typed.
  const fetcher = useFetcher<{ error: string }>();
  const pendingIntent = fetcher.state === "idle" ? undefined : fetcher.formData?.get("intent");
  const error = waterDialogError(fetcher.data?.error)
    ?? (selectedAmount === "custom" && customAmount !== "" && !validAmount ? ERROR_MESSAGES.invalid_amount : undefined);

  useEffect(() => {
    // The modal owns initial focus; only a switch to Custom moves it here.
    if (selectedAmount === "custom" && previousAmountRef.current !== "custom") amountInputRef.current?.focus();
    previousAmountRef.current = selectedAmount;
  }, [selectedAmount]);

  function recordConsumptionTime(submission: FormEvent<HTMLFormElement>) {
    if (event || initialLocalLogDate.slice(0, 10) !== maxLocalLogDate.slice(0, 10)) return;
    // Advance the account clock at save time without relying on the device's wall clock.
    // Historical entries keep the selected day's existing noon default.
    const instant = new Date(clock.instant + performance.now() - clock.startedAt).toISOString();
    const input = submission.currentTarget.elements.namedItem("localLogDate") as HTMLInputElement;
    input.value = waterEventLocalDateTime(instant, timeZone).slice(0, 16);
  }
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
          <p>{event ? "Change the amount" : "Record how much water you drank"}</p>
        </div>
        <Link aria-label="Close water dialog" className={foodLogStyles.dialogClose} to={closeHref}>×</Link>
      </div>
      <fetcher.Form action={actionHref} className={styles.form} method="post" onSubmit={recordConsumptionTime}>
        <input name="csrfToken" type="hidden" value={csrfToken} />
        <input name="returnDate" type="hidden" value={returnDate} />
        <input name="intent" type="hidden" value="save" />
        <fieldset disabled={pendingIntent !== undefined}>
          {event ? <input name="id" type="hidden" value={event.id} /> : (
            <input defaultValue={initialLocalLogDate} name="localLogDate" type="hidden" />
          )}
          <div className={styles.field}>
            <span id="water-amount-label">Amount (fl oz)</span>
            <div aria-labelledby="water-amount-label" className={styles.presets} role="group">
              {AMOUNT_PRESETS.map((preset) => (
                <button
                  aria-label={`${preset} fl oz`}
                  aria-pressed={selectedAmount === preset}
                  className={styles.preset}
                  data-water-initial-focus={(event ? event.ounces === preset : preset === "8") || undefined}
                  key={preset}
                  onClick={() => setSelectedAmount(preset)}
                  type="button"
                >
                  <strong>{preset}</strong>
                  <small>fl oz</small>
                </button>
              ))}
              <button
                aria-controls="water-custom-amount"
                aria-expanded={selectedAmount === "custom"}
                aria-pressed={selectedAmount === "custom"}
                className={`${styles.preset} ${styles.customPreset}`}
                onClick={() => {
                  setSelectedAmount("custom");
                  amountInputRef.current?.focus();
                }}
                type="button"
              >
                <UiIcon name="pencil" />
                <span>Custom</span>
              </button>
            </div>
            <div className={styles.customField} hidden={selectedAmount !== "custom"} id="water-custom-amount">
              <label htmlFor="water-ounces">Custom amount</label>
              <div className={styles.amountInput}>
                <input
                  aria-describedby={error ? "water-dialog-error" : undefined}
                  aria-invalid={selectedAmount === "custom" && customAmount !== "" && !validAmount || undefined}
                  data-water-initial-focus={event && !AMOUNT_PRESETS.includes(event.ounces) || undefined}
                  disabled={selectedAmount !== "custom"}
                  id="water-ounces"
                  inputMode="decimal"
                  max="500"
                  min="0.001"
                  name={selectedAmount === "custom" ? "ounces" : undefined}
                  onChange={(change) => setCustomAmount(change.currentTarget.value)}
                  placeholder="Enter amount"
                  ref={amountInputRef}
                  required={selectedAmount === "custom"}
                  step="0.001"
                  type="number"
                  value={customAmount}
                />
                <span>fl oz</span>
              </div>
            </div>
            {selectedAmount !== "custom" ? <input name="ounces" type="hidden" value={ounces} /> : null}
          </div>
          {error ? <p className={foodLogStyles.catalogError} id="water-dialog-error" role="alert">{error}</p> : null}
          <div className={styles.actions}>
            {event ? (
              <button className={foodLogStyles.dangerButton} onClick={() => setConfirmDelete(true)} type="button">
                Delete
              </button>
            ) : <span />}
            <div>
              <Link className={foodLogStyles.secondaryButton} to={closeHref}>Cancel</Link>
              <button className={styles.submitButton} disabled={!validAmount} type="submit">
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
