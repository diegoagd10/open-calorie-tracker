import { sql } from "drizzle-orm";

import { zonedDateTimeToUtc } from "../shared/date-time";
import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

/**
 * Converts Water Events migrated without an offset (`YYYY-MM-DDTHH:MM:SS`, the old Food Log
 * date and local time) to UTC instants, reading each wall-clock time in the account's time
 * zone, or UTC for an account without preferences. SQLite has no time zones, so this runs
 * in JavaScript after the migrations; converted rows end in `Z`, so later runs change nothing.
 */
export function convertLegacyWaterEventLogDates(client: BetterSQLite3Database): number {
  // A database opened with an earlier migration set has no log_date column yet.
  if (!client.get(sql`SELECT 1 FROM pragma_table_info('water_events') WHERE name = 'log_date'`)) return 0;
  const legacy = client.all<{ id: number; logDate: string; timeZone: string | null }>(sql`
    SELECT w.id, w.log_date AS logDate, p.time_zone AS timeZone
    FROM water_events w
    LEFT JOIN user_preferences p ON p.user_id = w.user_id
    WHERE w.log_date NOT LIKE '%Z'
  `);
  client.transaction((transaction) => {
    for (const row of legacy) {
      const logDate = zonedDateTimeToUtc(row.logDate, row.timeZone ?? "UTC");
      if (!logDate) throw new Error(`Water Event ${row.id} has an unreadable log date`);
      transaction.run(sql`UPDATE water_events SET log_date = ${logDate} WHERE id = ${row.id}`);
    }
  });
  return legacy.length;
}
