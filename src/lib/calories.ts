export type CalorieEntryInput = {
  name: string;
  calories: number;
  date: string;
};

export function calculateDailyTotal(
  entries: ReadonlyArray<{ calories: number }>,
) {
  return entries.reduce((total, entry) => total + entry.calories, 0);
}

export function prepareCalorieEntry(
  input: CalorieEntryInput,
): CalorieEntryInput {
  const name = input.name.trim();

  if (!name) {
    throw new Error("Food name is required");
  }

  if (!Number.isInteger(input.calories) || input.calories <= 0) {
    throw new Error("Calories must be a positive whole number");
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    throw new Error("Date must use YYYY-MM-DD");
  }

  return {
    ...input,
    name,
  };
}
