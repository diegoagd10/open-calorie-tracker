import * as fc from "fast-check";
import { expect, test } from "vitest";

import {
  addLocalDays,
  compareFoodLogEventsDescending,
  parseIsoLocalDate,
  type FoodLogEventOrderKey,
} from "../app/food-log/date";
import {
  DISPLAY_UNITS,
  WATER_UNIT_OPTIONS,
  waterTargetThousandthsFromMicroliters,
} from "../app/goals/water-conversion";
import {
  goalFieldsFromCanonical,
  validateGoalVersionFields,
} from "../app/goals/validation";
import { SETUP_LIMITS } from "../app/setup/validation";

const MILLISECONDS_PER_DAY = 86_400_000;
const PROPERTY_SEED = 53_053;
const DEFAULT_PROPERTY_RUNS = 200;

const requestedPropertyRuns = Number.parseInt(
  process.env.PROPERTY_TEST_RUNS ?? "",
  10,
);
const propertyParameters = {
  numRuns:
    Number.isSafeInteger(requestedPropertyRuns) && requestedPropertyRuns > 0
      ? requestedPropertyRuns
      : DEFAULT_PROPERTY_RUNS,
  seed: PROPERTY_SEED,
};

function utcCalendarDate(year: number, monthIndex: number, day = 1): Date {
  const instant = new Date(0);
  instant.setUTCHours(0, 0, 0, 0);
  instant.setUTCFullYear(year, monthIndex, day);
  return instant;
}

const firstSupportedDate = utcCalendarDate(0, 0, 1);
const lastSupportedDate = utcCalendarDate(9_999, 11, 31);
const lastSupportedDayIndex =
  (lastSupportedDate.getTime() - firstSupportedDate.getTime()) /
  MILLISECONDS_PER_DAY;

function supportedDateAt(dayIndex: number): string {
  const instant = new Date(
    firstSupportedDate.getTime() + dayIndex * MILLISECONDS_PER_DAY,
  );
  return [
    String(instant.getUTCFullYear()).padStart(4, "0"),
    String(instant.getUTCMonth() + 1).padStart(2, "0"),
    String(instant.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

const supportedDayIndexArbitrary = fc.integer({
  max: lastSupportedDayIndex,
  min: 0,
});
const canonicalLocalDateArbitrary = supportedDayIndexArbitrary.map(
  supportedDateAt,
);

function formatLocalDateParts(year: number, month: number, day: number) {
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function daysInMonth(year: number, month: number): number {
  return utcCalendarDate(year, month, 0).getUTCDate();
}

const yearMonthArbitrary = fc.record({
  month: fc.integer({ max: 12, min: 1 }),
  year: fc.integer({ max: 9_999, min: 0 }),
});
const invalidLocalDateArbitrary = fc.oneof(
  yearMonthArbitrary.map(({ month, year }) =>
    formatLocalDateParts(year, month, 0),
  ),
  fc
    .record({
      extraDays: fc.integer({ max: 68, min: 1 }),
      month: fc.integer({ max: 12, min: 1 }),
      year: fc.integer({ max: 9_999, min: 0 }),
    })
    .map(({ extraDays, month, year }) =>
      formatLocalDateParts(
        year,
        month,
        daysInMonth(year, month) + extraDays,
      ),
    ),
);

const eventArbitrary = fc.record({
  createdAt: fc.constantFrom(
    "2026-08-29T16:00:00.000Z",
    "2026-08-29T17:00:00.000Z",
    "2026-08-29T18:00:00.000Z",
  ),
  id: fc.integer({ max: 4, min: 1 }),
  kind: fc.constantFrom<FoodLogEventOrderKey["kind"]>("food", "water"),
  localEventTime: fc.constantFrom("00:00:00", "12:00:00", "23:59:59"),
});

function comparisonSign(value: number): number {
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 0;
}

function localTimeAt(secondOfDay: number): string {
  const hours = Math.floor(secondOfDay / 3_600);
  const minutes = Math.floor((secondOfDay % 3_600) / 60);
  const seconds = secondOfDay % 60;
  return [hours, minutes, seconds]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
}

const tieBreakerBaseArbitrary = fc.record({
  createdAtMillisecond: fc.integer({ max: 86_399_998, min: 0 }),
  id: fc.integer({ max: 2_147_483_646, min: 1 }),
  secondOfDay: fc.integer({ max: 86_398, min: 0 }),
});

const maximumMetricWaterMicroliters = Number(
  WATER_UNIT_OPTIONS.metric.maximumThousandths,
);
const canonicalWaterArbitrary = fc
  .integer({ max: maximumMetricWaterMicroliters, min: 1 })
  .filter((waterTargetMicroliters) => {
    const usThousandths = waterTargetThousandthsFromMicroliters(
      waterTargetMicroliters,
      "us",
    );
    return (
      usThousandths >= 1n &&
      usThousandths <= WATER_UNIT_OPTIONS.us.maximumThousandths
    );
  });

const canonicalGoalArbitrary = fc.record({
  calorieTargetMilliKcal: fc.integer({
    max: Number(SETUP_LIMITS.calories.maximumCanonical),
    min: 1,
  }),
  carbohydrateTargetMilligrams: fc.integer({
    max: Number(SETUP_LIMITS.nutrient.maximumCanonical),
    min: 1,
  }),
  effectiveDate: canonicalLocalDateArbitrary,
  fatTargetMilligrams: fc.integer({
    max: Number(SETUP_LIMITS.nutrient.maximumCanonical),
    min: 1,
  }),
  fiberTargetMilligrams: fc.integer({
    max: Number(SETUP_LIMITS.nutrient.maximumCanonical),
    min: 1,
  }),
  proteinTargetMilligrams: fc.integer({
    max: Number(SETUP_LIMITS.nutrient.maximumCanonical),
    min: 1,
  }),
  sodiumMaximumMilligrams: fc.integer({
    max: Number(SETUP_LIMITS.sodium.maximumCanonical),
    min: 1,
  }),
  sugarMaximumMilligrams: fc.integer({
    max: Number(SETUP_LIMITS.nutrient.maximumCanonical),
    min: 1,
  }),
  waterTargetMicroliters: canonicalWaterArbitrary,
});

test("adding and inversely subtracting civil days preserves supported dates", () => {
  fc.assert(
    fc.property(
      supportedDayIndexArbitrary,
      supportedDayIndexArbitrary,
      (startDayIndex, endDayIndex) => {
        const start = supportedDateAt(startDayIndex);
        const amount = endDayIndex - startDayIndex;
        const shifted = addLocalDays(start, amount);

        expect(parseIsoLocalDate(shifted)).toBe(shifted);
        expect(addLocalDays(shifted, -amount)).toBe(start);
      },
    ),
    propertyParameters,
  );
});

test("ISO local-date parsing preserves every canonical supported date", () => {
  fc.assert(
    fc.property(canonicalLocalDateArbitrary, (localDate) => {
      expect(parseIsoLocalDate(localDate)).toBe(localDate);
    }),
    propertyParameters,
  );
});

test("ISO local-date parsing rejects impossible calendar dates", () => {
  fc.assert(
    fc.property(invalidLocalDateArbitrary, (localDate) => {
      expect(parseIsoLocalDate(localDate)).toBeUndefined();
    }),
    propertyParameters,
  );
});

test("Food Log event comparison is antisymmetric", () => {
  fc.assert(
    fc.property(eventArbitrary, eventArbitrary, (left, right) => {
      expect(
        comparisonSign(compareFoodLogEventsDescending(left, right)),
      ).toBe(
        comparisonSign(-compareFoodLogEventsDescending(right, left)),
      );
    }),
    propertyParameters,
  );
});

test("Food Log event comparison is transitive", () => {
  fc.assert(
    fc.property(eventArbitrary, eventArbitrary, eventArbitrary, (a, b, c) => {
      const ab = compareFoodLogEventsDescending(a, b);
      const bc = compareFoodLogEventsDescending(b, c);
      const ac = compareFoodLogEventsDescending(a, c);
      const ascendingTransitivity = !(ab <= 0 && bc <= 0) || ac <= 0;
      const descendingTransitivity = !(ab >= 0 && bc >= 0) || ac >= 0;

      expect(ascendingTransitivity && descendingTransitivity).toBe(true);
    }),
    propertyParameters,
  );
});

test("Food Log event comparison applies every descending tie-breaker", () => {
  fc.assert(
    fc.property(
      tieBreakerBaseArbitrary,
      ({ createdAtMillisecond, id, secondOfDay }) => {
        const createdAt = new Date(
          Date.UTC(2026, 0, 1) + createdAtMillisecond,
        ).toISOString();
        const base = {
          createdAt,
          id,
          kind: "water" as const,
          localEventTime: localTimeAt(secondOfDay),
        };

        expect(
          compareFoodLogEventsDescending(base, {
            ...base,
            localEventTime: localTimeAt(secondOfDay + 1),
          }),
        ).toBeGreaterThan(0);
        expect(
          compareFoodLogEventsDescending(base, {
            ...base,
            createdAt: new Date(
              Date.parse(createdAt) + 1,
            ).toISOString(),
          }),
        ).toBeGreaterThan(0);
        expect(
          compareFoodLogEventsDescending(base, { ...base, id: id + 1 }),
        ).toBeGreaterThan(0);
        expect(
          compareFoodLogEventsDescending(
            { ...base, kind: "food" },
            base,
          ),
        ).toBeLessThan(0);
      },
    ),
    propertyParameters,
  );
});

test("canonical goals round-trip through every supported display unit", () => {
  fc.assert(
    fc.property(canonicalGoalArbitrary, (goal) => {
      for (const displayUnits of DISPLAY_UNITS) {
        const fields = goalFieldsFromCanonical(goal, displayUnits);
        const result = validateGoalVersionFields(
          { ...fields, displayUnits },
          "UTC",
          goal,
        );

        expect(result.success).toBe(true);
        if (!result.success) throw new Error(result.error);
        expect(result.data).toEqual({ ...goal, displayUnits });
      }
    }),
    propertyParameters,
  );
});
