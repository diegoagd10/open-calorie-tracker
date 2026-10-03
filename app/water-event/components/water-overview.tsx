import type { CSSProperties } from "react";
import { Link } from "react-router";

import foodLogStyles from "../../food-log.module.css";
import styles from "../water-event.module.css";
import { formatWaterAmount, type WaterDisplayUnits } from "../water-event.utils";

/** The day's water total against its goal, opening the add-water dialog. */
export function WaterOverview({ addHref, displayUnits, goalOunces, totalOunces }: {
  addHref: string;
  displayUnits: WaterDisplayUnits;
  goalOunces: string | null;
  totalOunces: string;
}) {
  const goal = Number(goalOunces ?? 0);
  const total = Number(totalOunces);
  const totalDisplay = formatWaterAmount(totalOunces, displayUnits);
  const goalDisplay = goalOunces ? formatWaterAmount(goalOunces, displayUnits) : undefined;
  return (
    <section aria-labelledby="water-heading" className={`${foodLogStyles.waterOverview} ${styles.overview}`}>
      <Link className={styles.overviewRow} data-water-dialog-trigger to={addHref}>
        <strong id="water-heading">Water</strong>
        <span>
          {totalDisplay} <small>{goalDisplay ? `/ ${goalDisplay}` : "/ No active goal"}</small>
        </span>
        <span aria-hidden="true">›</span>
      </Link>
      {goal > 0 ? (
        <div
          aria-label="Water progress"
          aria-valuemax={goal}
          aria-valuemin={0}
          aria-valuenow={Math.min(total, goal)}
          aria-valuetext={`${totalDisplay} of ${goalDisplay} target`}
          className={`${foodLogStyles.linearProgress} ${styles.progress}`}
          role="progressbar"
          style={{ "--progress": `${Math.min(100, (total / goal) * 100)}%` } as CSSProperties}
        >
          <span />
        </div>
      ) : null}
    </section>
  );
}
