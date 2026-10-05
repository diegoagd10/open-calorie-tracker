import type { ReactNode } from "react";
import { Link } from "react-router";

import styles from "../../food-log.module.css";
import eventStyles from "../food-event.module.css";
import type { FoodEvent } from "../food-event.model";
import { foodSourceLabel, formatEnergy, formatFoodEventTime, formatServing } from "../format";

/** One Food Event in the Food Log timeline, opening its editor. */
export function FoodTimelineItem({ editHref, event, icon, timeZone }: {
  editHref: string;
  event: Pick<FoodEvent, "id" | "logDate" | "name" | "source" | "measurement" | "quantityMicrounits" | "nutrients">;
  /** The timeline's food marker icon. */
  icon?: ReactNode;
  timeZone: string;
}) {
  return (
    <article>
      <Link className={styles.foodEntryCard} data-entry-editor-trigger to={editHref}>
        <time dateTime={event.logDate}>{formatFoodEventTime(event.logDate, timeZone)}</time>
        <span className={eventStyles.foodEntryMarker} aria-hidden="true">{icon}</span>
        <span className={styles.foodEntryContent}>
          <strong>{event.name}</strong>
          <small>{foodSourceLabel(event.source)}</small>
          <small>{formatServing(event)}</small>
        </span>
        <span className={styles.foodEntryEnergy}>
          {formatEnergy(event.nutrients.energyMilliKcal)}{" "}
          <small>kcal</small>
        </span>
      </Link>
    </article>
  );
}

/** The row a catalog food occupies while its save is in flight. */
export function PendingFoodTimelineItem({ name }: { name: string }) {
  return (
    <article>
      <div
        aria-label="Adding food to Daily log"
        aria-live="polite"
        className={`${styles.foodEntryCard} ${eventStyles.pendingFoodEntryCard}`}
        role="status"
      >
        <span className={eventStyles.pendingTime} />
        <span className={eventStyles.pendingEntryMarker} aria-hidden="true" />
        <span className={eventStyles.pendingEntryContent}>
          <strong>{name}</strong>
          <span className={eventStyles.pendingEntryLine} />
          <span className={eventStyles.pendingEntryLineShort} />
        </span>
        <span className={eventStyles.pendingEntryEnergy} />
      </div>
    </article>
  );
}
