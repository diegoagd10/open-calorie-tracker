export type FoodLogEventOrderKey = {
  createdAt: string;
  id: number;
  kind: "food" | "water";
  localEventTime: string;
};

const EVENT_KIND_TIE_BREAKER = { food: 1, water: 0 } as const;

function isoLocalDatePattern(): RegExp {
  return /(\d{4})-(\d{2})-(\d{2})/;
}

function isoLocalMonthPattern(): RegExp {
  return /^(\d{4})-(\d{2})$/;
}

function utcCalendarDate(year: number, monthIndex: number, day = 1): Date {
  const instant = new Date(0);
  instant.setUTCFullYear(year, monthIndex, day);
  return instant;
}

function utcDateFromLocalDate(localDate: string): Date {
  const match = isoLocalDatePattern().exec(localDate)!;
  return utcCalendarDate(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  );
}

function formatUtcLocalDate(instant: Date): string {
  return [
    String(instant.getUTCFullYear()).padStart(4, "0"),
    String(instant.getUTCMonth() + 1).padStart(2, "0"),
    String(instant.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function parseIsoLocalDate(value: string): string | undefined {
  const match = isoLocalDatePattern().exec(value);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const instant = utcCalendarDate(year, month - 1, day);

  if (formatUtcLocalDate(instant) !== value) {
    return undefined;
  }

  return value;
}

export function localDateAt(instant: Date, timeZone: string): string {
  const stableInstant = new Date(instant.getTime());
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(stableInstant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)!.value;

  return `${value("year")}-${value("month")}-${value("day")}`;
}

export function addLocalDays(localDate: string, amount: number): string {
  const parsed = parseIsoLocalDate(localDate);
  if (!parsed || !Number.isInteger(amount)) throw new Error("Invalid local date");

  const instant = utcDateFromLocalDate(parsed);
  instant.setUTCDate(instant.getUTCDate() + amount);
  return formatUtcLocalDate(instant);
}

export function getNearbyLocalDates(selectedDate: string, today: string) {
  const daysSinceMonday = (utcDateFromLocalDate(selectedDate).getUTCDay() + 6) % 7;
  return Array.from({ length: 7 }, (_, index) =>
    localDayState(
      addLocalDays(selectedDate, index - daysSinceMonday),
      today,
      selectedDate,
    ),
  );
}

function shiftLocalMonth(localMonth: string, amount: number): string {
  const match = isoLocalMonthPattern().exec(localMonth)!;

  const instant = utcCalendarDate(
    Number(match[1]),
    Number(match[2]) - 1,
  );
  instant.setUTCMonth(instant.getUTCMonth() + amount);
  return `${String(instant.getUTCFullYear()).padStart(4, "0")}-${String(
    instant.getUTCMonth() + 1,
  ).padStart(2, "0")}`;
}

export function buildCalendarMonth(
  requestedMonth: string,
  today: string,
  selectedDate: string,
) {
  const todayMonth = today.slice(0, 7);
  const match = isoLocalMonthPattern().exec(requestedMonth);
  const requestedMonthNumber = match ? Number(match[2]) : 0;
  const validRequestedMonth =
    Boolean(match) && requestedMonthNumber >= 1 && requestedMonthNumber <= 12;
  // Stryker disable EqualityOperator: <= is equivalent because equality falls back to the identical todayMonth value.
  const month =
    validRequestedMonth && requestedMonth < todayMonth
      ? requestedMonth
      : todayMonth;
  // Stryker restore EqualityOperator
  const [year, monthNumber] = month.split("-").map(Number);
  const first = utcCalendarDate(year, monthNumber - 1);
  const numberOfDays = utcCalendarDate(year, monthNumber, 0).getUTCDate();

  return {
    days: Array.from({ length: numberOfDays }, (_, index) => {
      const day = index + 1;
      const date = `${month}-${String(day).padStart(2, "0")}`;
      return { day, ...localDayState(date, today, selectedDate) };
    }),
    label: new Intl.DateTimeFormat("en-US", {
      month: "long",
      timeZone: "UTC",
      year: "numeric",
    }).format(first),
    leadingEmptyDays: first.getUTCDay(),
    month,
    nextMonth: month < todayMonth ? shiftLocalMonth(month, 1) : undefined,
    previousMonth: shiftLocalMonth(month, -1),
  };
}

function localDayState(date: string, today: string, selectedDate: string) {
  return {
    date,
    isFuture: date > today,
    isSelected: date === selectedDate,
    isToday: date === today,
  };
}

export function formatLocalDate(
  localDate: string,
  options: Intl.DateTimeFormatOptions,
): string {
  const parsed = parseIsoLocalDate(localDate);
  if (!parsed) throw new Error("Invalid local date");
  return new Intl.DateTimeFormat("en-US", {
    ...options,
    timeZone: "UTC",
  }).format(utcDateFromLocalDate(parsed));
}

export function compareFoodLogEventsDescending(
  left: FoodLogEventOrderKey,
  right: FoodLogEventOrderKey,
): number {
  return (
    right.localEventTime.localeCompare(left.localEventTime) ||
    right.createdAt.localeCompare(left.createdAt) ||
    right.id - left.id ||
    EVENT_KIND_TIE_BREAKER[right.kind] - EVENT_KIND_TIE_BREAKER[left.kind]
  );
}
