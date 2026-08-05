import { describe, expect, it } from "vitest";
import { calculateDailyTotal, prepareCalorieEntry } from "./calories";

describe("prepareCalorieEntry", () => {
  it("normalizes a valid food entry", () => {
    expect(
      prepareCalorieEntry({
        name: "  Banana  ",
        calories: 105,
        date: "2026-08-04",
      }),
    ).toEqual({
      name: "Banana",
      calories: 105,
      date: "2026-08-04",
    });
  });

  it.each([
    [{ name: "", calories: 100, date: "2026-08-04" }, "Food name is required"],
    [{ name: "Rice", calories: 0, date: "2026-08-04" }, "Calories must be a positive whole number"],
    [{ name: "Rice", calories: 12.5, date: "2026-08-04" }, "Calories must be a positive whole number"],
    [{ name: "Rice", calories: 100, date: "08/04/2026" }, "Date must use YYYY-MM-DD"],
  ])("rejects invalid input", (input, message) => {
    expect(() => prepareCalorieEntry(input)).toThrow(message);
  });
});

describe("calculateDailyTotal", () => {
  it("sums the calories in a day's entries", () => {
    expect(
      calculateDailyTotal([
        { calories: 250 },
        { calories: 105 },
        { calories: 430 },
      ]),
    ).toBe(785);
  });
});
