/** A decimal amount of fluid ounces, such as `"12.5"`. */
export type Quantity = { ounces: string };

/** An inclusive `from` and exclusive `to`, both ISO date-times with offsets. */
export type WaterEventRange = { from: string; to: string };

/** Omit `id` to create an event; provide it to change only that event's amount. */
export type CreateWaterEvent =
  | { id?: undefined; logDate: string; quantity: Quantity }
  | { id: number; quantity: Quantity };

export type WaterEvent = {
  id: number;
  userId: number;
  /** UTC ISO date-time of consumption. */
  logDate: string;
  ounces: string;
  /** UTC instant the record was saved. */
  createdAt: string;
  /** UTC instant of the last edit. */
  updatedAt: string;
};

export type WaterEventList = { events: WaterEvent[]; totalOunces: string };
