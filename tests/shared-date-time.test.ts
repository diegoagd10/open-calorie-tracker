import { describe, expect, test } from "vitest";

import {
  localDayRange,
  parseIsoDateTime,
  utcToZonedDateTime,
  zonedDateTimeToUtc,
} from "../app/shared/date-time";

describe("parseIsoDateTime", () => {
  test("normalizes offset-bearing date-times to UTC", () => {
    expect(parseIsoDateTime("2026-09-30T14:45:00-04:00")).toBe("2026-09-30T18:45:00.000Z");
    expect(parseIsoDateTime("2026-09-30T18:45:00Z")).toBe("2026-09-30T18:45:00.000Z");
    expect(parseIsoDateTime("2026-09-30T20:15+05:30")).toBe("2026-09-30T14:45:00.000Z");
    expect(parseIsoDateTime("2026-09-30T18:45:00.5Z")).toBe("2026-09-30T18:45:00.500Z");
  });

  test.each([
    "2026-09-30T14:45:00",
    "not-a-date",
    "2026-02-30T00:00:00Z",
    "2026-09-30T24:00:00Z",
    "2026-09-30T14:45:00+24:00",
    "2026-09-30T14:45:00+05:60",
    "2026-09-30T14:45:00.1234Z",
    "2026-09-30 14:45:00Z",
  ])("rejects %s", (value) => {
    expect(parseIsoDateTime(value)).toBeNull();
  });

});

describe("zoned wall-clock conversion", () => {
  test("converts a local date-time in a time zone to UTC and back", () => {
    expect(zonedDateTimeToUtc("2026-09-30T14:45", "America/New_York")).toBe("2026-09-30T18:45:00.000Z");
    expect(zonedDateTimeToUtc("2026-09-30T20:15:30", "Asia/Kolkata")).toBe("2026-09-30T14:45:30.000Z");
    expect(utcToZonedDateTime("2026-09-30T18:45:00.000Z", "America/New_York")).toBe("2026-09-30T14:45:00");
  });

  test("resolves a repeated hour to the earlier instant and a skipped hour forward", () => {
    expect(zonedDateTimeToUtc("2026-11-01T01:30", "America/New_York")).toBe("2026-11-01T05:30:00.000Z");
    expect(zonedDateTimeToUtc("2026-03-08T02:30", "America/New_York")).toBe("2026-03-08T07:30:00.000Z");
  });

  test("rejects invalid local date-times", () => {
    expect(zonedDateTimeToUtc("2026-02-30T10:00", "UTC")).toBeNull();
    expect(zonedDateTimeToUtc("2026-09-30T14:45Z", "UTC")).toBeNull();
    expect(zonedDateTimeToUtc("", "UTC")).toBeNull();
  });

  test("covers a local day, including days with a clock change", () => {
    expect(localDayRange("2026-09-30", "America/New_York")).toEqual({
      from: "2026-09-30T04:00:00.000Z",
      to: "2026-10-01T04:00:00.000Z",
    });
    expect(localDayRange("2026-11-01", "America/New_York")).toEqual({
      from: "2026-11-01T04:00:00.000Z",
      to: "2026-11-02T05:00:00.000Z",
    });
    expect(localDayRange("2026-12-31", "UTC")).toEqual({
      from: "2026-12-31T00:00:00.000Z",
      to: "2027-01-01T00:00:00.000Z",
    });
    expect(() => localDayRange("2026-13-01", "UTC")).toThrow("Invalid local date");
  });
});
