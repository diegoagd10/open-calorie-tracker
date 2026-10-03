import type { ApplicationDatabaseClient } from "../database/database.server";
import { getApplicationDatabase } from "../database/runtime.server";
import { WaterEventRepository } from "./water-event.repository.server";
import { WaterEventService } from "./water-event.server";

let waterEventService: WaterEventService | undefined;

function waterEventClock(): () => Date {
  const configuredInstant =
    process.env.NODE_ENV === "test" ? process.env.FOOD_LOG_TEST_NOW : undefined;
  if (!configuredInstant) return () => new Date();
  const instant = new Date(configuredInstant);
  if (Number.isNaN(instant.getTime())) {
    throw new Error("FOOD_LOG_TEST_NOW must be an ISO date-time");
  }
  return () => new Date(instant);
}

/** A Water Event service over `database` with its own clock, for callers that already hold a client. */
export function createWaterEventService(database: ApplicationDatabaseClient, now: () => Date): WaterEventService {
  return new WaterEventService(new WaterEventRepository(database, now), now);
}

export function getWaterEventService(now?: Date): WaterEventService {
  if (now) {
    return createWaterEventService(getApplicationDatabase().getClient(), () => new Date(now));
  }
  if (!waterEventService) {
    const clock = waterEventClock();
    waterEventService = createWaterEventService(getApplicationDatabase().getClient(), clock);
  }
  return waterEventService;
}
