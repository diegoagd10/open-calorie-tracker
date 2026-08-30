import { getApplicationDatabase } from "../database/runtime.server";
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

export function getWaterEventService(now?: Date): WaterEventService {
  if (now) {
    return new WaterEventService(
      getApplicationDatabase().getClient(),
      () => new Date(now),
    );
  }
  waterEventService ??= new WaterEventService(
    getApplicationDatabase().getClient(),
    waterEventClock(),
  );
  return waterEventService;
}
