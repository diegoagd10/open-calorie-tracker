export type FoodLogEventOrderKey = {
  createdAt: string;
  id: number;
  localEventTime: string;
};

const ISO_LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const ISO_LOCAL_MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

function utcDateFromLocalDate(localDate: string): Date {
  return new Date(`${localDate}T00:00:00.000Z`);
}

function formatUtcLocalDate(instant: Date): string {
  return [
    String(instant.getUTCFullYear()).padStart(4, "0"),
    String(instant.getUTCMonth() + 1).padStart(2, "0"),
    String(instant.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

export function parseIsoLocalDate(value: string): string | undefined {
  const match = ISO_LOCAL_DATE_PATTERN.exec(value);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const instant = new Date(Date.UTC(year, month - 1, day));

  if (
    instant.getUTCFullYear() !== year ||
    instant.getUTCMonth() !== month - 1 ||
    instant.getUTCDate() !== day
  ) {
    return undefined;
  }

  return value;
}

export function localDateAt(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    month: "2-digit",
    timeZone,
    year: "numeric",
  }).formatToParts(instant);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value;

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
  return Array.from({ length: 7 }, (_, index) => {
    const date = addLocalDays(selectedDate, index - 5);
    return {
      date,
      isFuture: date > today,
      isSelected: date === selectedDate,
      isToday: date === today,
    };
  });
}

function shiftLocalMonth(localMonth: string, amount: number): string {
  const match = ISO_LOCAL_MONTH_PATTERN.exec(localMonth);
  if (!match || !Number.isInteger(amount)) throw new Error("Invalid local month");

  const instant = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1));
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
  const match = ISO_LOCAL_MONTH_PATTERN.exec(requestedMonth);
  const requestedMonthNumber = match ? Number(match[2]) : 0;
  const validRequestedMonth =
    Boolean(match) && requestedMonthNumber >= 1 && requestedMonthNumber <= 12;
  const month =
    validRequestedMonth && requestedMonth <= todayMonth
      ? requestedMonth
      : todayMonth;
  const [year, monthNumber] = month.split("-").map(Number);
  const first = new Date(Date.UTC(year, monthNumber - 1, 1));
  const numberOfDays = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();

  return {
    days: Array.from({ length: numberOfDays }, (_, index) => {
      const day = index + 1;
      const date = `${month}-${String(day).padStart(2, "0")}`;
      return {
        date,
        day,
        isFuture: date > today,
        isSelected: date === selectedDate,
        isToday: date === today,
      };
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
    right.id - left.id
  );
}
