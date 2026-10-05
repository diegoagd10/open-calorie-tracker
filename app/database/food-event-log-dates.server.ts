import { sql } from "drizzle-orm";

import { zonedDateTimeToUtc } from "../shared/date-time";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

/**
 * Converts Food Events migrated without an offset (`YYYY-MM-DDTHH:MM:SS`, the old Food Log date
 * and local time) to UTC instants, reading each wall-clock time in the account's current time
 * zone, or UTC for an account without preferences. The original zone was never stored, so an
 * account that changed zones sees that history shift by the difference.
 *
 * SQLite has no time zones, so this runs in JavaScript after the migrations, in one transaction:
 * an unreadable value rolls every row back and fails startup, and the next start retries from
 * the beginning. Converted rows end in `Z`, so later runs change nothing.
 */
export function convertLegacyFoodEventLogDates(client: BetterSQLite3Database): number {
  // A database opened with an earlier migration set has no food_events table yet.
  if (!client.get(sql`SELECT 1 FROM pragma_table_info('food_events') WHERE name = 'log_date'`)) return 0;
  const legacy = client.all<{ id: number; logDate: string; timeZone: string | null }>(sql`
    SELECT f.id, f.log_date AS logDate, p.time_zone AS timeZone
    FROM food_events f
    LEFT JOIN user_preferences p ON p.user_id = f.user_id
    WHERE f.log_date NOT LIKE '%Z'
  `);
  client.transaction((transaction) => {
    for (const row of legacy) {
      const logDate = zonedDateTimeToUtc(row.logDate, row.timeZone ?? "UTC");
      if (!logDate) throw new Error(`Food Event ${row.id} has an unreadable log date`);
      transaction.run(sql`UPDATE food_events SET log_date = ${logDate} WHERE id = ${row.id}`);
    }
  });
  return legacy.length;
}
