import type { ReactNode } from "react";
import { Link } from "react-router";

import type { WaterEvent } from "../water-event.model";
import foodLogStyles from "../../food-log.module.css";
import styles from "../water-event.module.css";
import { formatWaterAmount, formatWaterTime, type WaterDisplayUnits } from "../water-event.utils";

/** One Water Event in the Food Log timeline, opening its amount editor. */
export function WaterTimelineItem({ displayUnits, editHref, event, icon, timeZone }: {
  displayUnits: WaterDisplayUnits;
  editHref: string;
  event: Pick<WaterEvent, "id" | "logDate" | "ounces">;
  /** The timeline's water marker icon. */
  icon?: ReactNode;
  timeZone: string;
}) {
  return (
    <article>
      <Link className={`${foodLogStyles.foodEntryCard} ${styles.card}`} data-water-editor-trigger to={editHref}>
        <time dateTime={event.logDate}>{formatWaterTime(event.logDate, timeZone)}</time>
        <span aria-hidden="true" className={styles.marker}>{icon}</span>
        <span className={foodLogStyles.foodEntryContent}>
          <strong>Water</strong>
        </span>
        <strong className={foodLogStyles.foodEntryEnergy}>{formatWaterAmount(event.ounces, displayUnits)}</strong>
      </Link>
    </article>
  );
}
