import { Link } from "react-router";

import styles from "../../food-log.module.css";
import eventStyles from "../food-event.module.css";
import { DialogBackdrop, useModalDialog } from "../../shared/modal-dialog";
import { formatLocalDate } from "../../shared/local-date";
import type { CopyFoodEventDialogModel } from "../food-event.model";
import { copyHref, editorHref, FOOD_EVENT_FETCHERS, foodLogHref } from "../links";
import { useFoodEventFetcher } from "./food-fields";

function fullDate(date: string): string {
  return formatLocalDate(date, { day: "numeric", month: "long", weekday: "long", year: "numeric" });
}

/** Copies an earlier day's event to a chosen eligible date, then returns to the source day. */
export function CopyFoodEventDialog({
  csrfToken,
  dialog,
}: {
  csrfToken: string;
  dialog: CopyFoodEventDialogModel;
}) {
  const fetcher = useFoodEventFetcher(FOOD_EVENT_FETCHERS.copy);
  const { event, sourceDate } = dialog;
  const closeHref = foodLogHref(sourceDate);
  const { closeDialog, dialogRef, handleDialogKeyDown } = useModalDialog({
    closeHref,
    initialFocusSelector: "[data-copy-calendar-day]",
    restoreFocusSelector: `[data-entry-editor-trigger][href="${editorHref(sourceDate, event.id)}"]`,
  });
  const pending = fetcher.state !== "idle";

  const calendarHref = (month: string) =>
    copyHref(sourceDate, event.id, {
      destinationDate: dialog.destinationDate,
      month,
    });

  return (
    <DialogBackdrop onClose={closeDialog}>
      <section
        aria-labelledby="copy-food-entry-title"
        aria-modal="true"
        className={styles.foodDialog}
        onKeyDown={handleDialogKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <div className={styles.dialogHead}>
          <div>
            <h2 id="copy-food-entry-title">Copy {event.name}</h2>
            <p>Choose a destination and review it before creating the copy.</p>
          </div>
          <Link
            aria-label="Close copy dialog"
            className={styles.dialogClose}
            to={closeHref}
          >
            ×
          </Link>
        </div>
        <div className={eventStyles.copyCalendar}>
          <div className={styles.calendarHead}>
            <Link
              aria-label="Previous month"
              className={styles.calendarNav}
              to={calendarHref(dialog.calendar.previousMonth)}
            >
              ‹
            </Link>
            <strong>{dialog.calendar.label}</strong>
            {dialog.calendar.nextMonth ? (
              <Link
                aria-label="Next month"
                className={styles.calendarNav}
                to={calendarHref(dialog.calendar.nextMonth)}
              >
                ›
              </Link>
            ) : (
              <button
                aria-label="Next month"
                className={styles.calendarNavDisabled}
                disabled
                type="button"
              >
                ›
              </button>
            )}
          </div>
          <div
            aria-label={`${dialog.calendar.label} destination calendar`}
            className={styles.calendarGrid}
          >
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
              (day) => (
                <span className={styles.weekday} key={day}>
                  {day}
                </span>
              ),
            )}
            {Array.from(
              { length: dialog.calendar.leadingEmptyDays },
              (_, index) => (
                <span aria-hidden="true" key={`copy-empty-${index}`} />
              ),
            )}
            {dialog.calendar.days.map((day) => {
              const label = formatLocalDate(day.date, {
                day: "numeric",
                month: "long",
                weekday: "long",
              });
              const disabled = day.isFuture || day.isSource;
              const className = [
                disabled ? styles.calendarFuture : styles.calendarDay,
                day.isToday ? styles.calendarToday : "",
                day.isSelected ? styles.calendarSelected : "",
              ]
                .filter(Boolean)
                .join(" ");
              return disabled ? (
                <button
                  aria-label={label}
                  className={className}
                  disabled
                  key={day.date}
                  type="button"
                >
                  {day.day}
                </button>
              ) : (
                <Link
                  aria-current={day.isSelected ? "date" : undefined}
                  aria-label={label}
                  className={className}
                  data-copy-calendar-day
                  key={day.date}
                  to={copyHref(sourceDate, event.id, {
                    destinationDate: day.date,
                    month: dialog.calendar.month,
                  })}
                >
                  {day.day}
                </Link>
              );
            })}
          </div>
        </div>
        <div className={eventStyles.copyDestination} aria-live="polite">
          <span>Destination</span>
          <strong>
            {dialog.destinationDate
              ? fullDate(dialog.destinationDate)
              : "Choose an eligible date"}
          </strong>
        </div>
        {fetcher.data?.message ? (
          <p className={styles.catalogError} role="alert">
            {fetcher.data.message}
          </p>
        ) : null}
        <fetcher.Form action="/food-events" className={eventStyles.copyActions} method="post">
          <input name="csrfToken" type="hidden" value={csrfToken} />
          <input name="intent" type="hidden" value="copy" />
          <input name="id" type="hidden" value={event.id} />
          <input name="date" type="hidden" value={sourceDate} />
          {dialog.destinationDate ? <input name="destinationDate" type="hidden" value={dialog.destinationDate} /> : null}
          <Link
            className={styles.secondaryButton}
            to={closeHref}
          >
            Cancel
          </Link>
          <button
            className={eventStyles.primaryButton}
            disabled={!dialog.destinationDate || pending}
            type="submit"
          >
            {pending ? "Copying…" : "Copy"}
          </button>
        </fetcher.Form>
      </section>
    </DialogBackdrop>
  );
}
