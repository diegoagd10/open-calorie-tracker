import type { waterEvents } from "../database/schema.server";

/** A Water Event in the v1 REST API format shared by the daily log and water logging. */
export function presentWaterEvent(event: Pick<
  typeof waterEvents.$inferSelect,
  "id" | "foodLogDate" | "localEventTime" | "createdAt" | "updatedAt" | "amountMicroliters" | "preset8Count" | "preset16Count" | "preset24Count"
>) {
  return {
    id: event.id,
    foodLogDate: event.foodLogDate,
    localEventTime: event.localEventTime,
    createdAt: event.createdAt,
    updatedAt: event.updatedAt,
    amountMicroliters: event.amountMicroliters,
    preset8Count: event.preset8Count,
    preset16Count: event.preset16Count,
    preset24Count: event.preset24Count,
  };
}
