import { sql } from "drizzle-orm";

import type { ApplicationDatabaseClient } from "../database/database.server";

export type EventTimeDatabase = Pick<ApplicationDatabaseClient, "get">;

function localTimeAt(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    hour: "2-digit",
    hourCycle: "h23",
    minute: "2-digit",
    second: "2-digit",
    timeZone,
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)!.value;
  return `${value("hour")}:${value("minute")}:${value("second")}`;
}

function nextRetroactiveTime(latest: string | null): string {
  if (!latest) return "12:00:00";
  const [hour, minute, second] = latest.split(":").map(Number);
  const totalSeconds = hour * 3_600 + minute * 60 + second;
  if (totalSeconds >= 86_340) return latest;
  const next = totalSeconds + 60;
  return [Math.floor(next / 3_600), Math.floor((next % 3_600) / 60), next % 60]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

export function localEventTimeForNewFoodLogEvent(
  database: EventTimeDatabase,
  userId: number,
  foodLogDate: string,
  today: string,
  instant: Date,
  timeZone: string,
): string {
  if (foodLogDate === today) return localTimeAt(instant, timeZone);
  const latest = database.get<{ localEventTime: string | null }>(sql`
    SELECT MAX(local_event_time) AS localEventTime
    FROM (
      SELECT local_event_time
      FROM food_entries
      WHERE user_id = ${userId} AND food_log_date = ${foodLogDate}
      UNION ALL
      SELECT local_event_time
      FROM photo_meals
      WHERE user_id = ${userId} AND food_log_date = ${foodLogDate}
    )
  `);
  return nextRetroactiveTime(latest?.localEventTime ?? null);
}

export function localEventTimeForCopiedFoodEntry(
  database: EventTimeDatabase,
  userId: number,
  foodLogDate: string,
  today: string,
  instant: Date,
  timeZone: string,
): string {
  if (foodLogDate === today) return localTimeAt(instant, timeZone);
  const latest = database.get<{ localEventTime: string | null }>(sql`
    SELECT MAX(local_event_time) AS localEventTime
    FROM food_entries
    WHERE user_id = ${userId} AND food_log_date = ${foodLogDate}
  `);
  return nextRetroactiveTime(latest?.localEventTime ?? null);
}

export function nextUpdatedAt(now: Date, previous: string): string {
  const candidate = now.toISOString();
  if (candidate > previous) return candidate;
  return new Date(new Date(previous).getTime() + 1).toISOString();
}
