export const DISPLAY_UNITS = ["us", "metric"] as const;
export type DisplayUnits = (typeof DISPLAY_UNITS)[number];

export const SETUP_LIMITS = {
  calories: { displayMaximum: "20000", maximumCanonical: 20_000_000n },
  nutrient: { displayMaximum: "2000", maximumCanonical: 2_000_000n },
  sodium: { displayMaximum: "100000", maximumCanonical: 100_000n },
} as const;

export const WATER_UNIT_OPTIONS = {
  metric: {
    canonicalDenominator: 1n,
    canonicalNumerator: 1n,
    defaultValue: "2366",
    displayMaximum: "15000",
    error: "Water must be from 0.001 to 15,000 ml.",
    maximumThousandths: 15_000_000n,
    unit: "ml",
  },
  us: {
    canonicalDenominator: 10_000_000_000n,
    canonicalNumerator: 295_735_295_625n,
    defaultValue: "80",
    displayMaximum: "500",
    error: "Water must be from 0.001 to 500 fl oz.",
    maximumThousandths: 500_000n,
    unit: "fl oz",
  },
} as const satisfies Record<
  DisplayUnits,
  {
    canonicalDenominator: bigint;
    canonicalNumerator: bigint;
    defaultValue: string;
    displayMaximum: string;
    error: string;
    maximumThousandths: bigint;
    unit: string;
  }
>;

export const SETUP_NUTRIENT_FIELDS = [
  {
    defaultValue: "120",
    formLabel: "Protein target",
    name: "protein",
    validationLabel: "Protein",
  },
  {
    defaultValue: "230",
    formLabel: "Carbohydrate target",
    name: "carbohydrate",
    validationLabel: "Carbohydrate",
  },
  {
    defaultValue: "70",
    formLabel: "Fat target",
    name: "fat",
    validationLabel: "Fat",
  },
  {
    defaultValue: "25",
    formLabel: "Fiber target",
    name: "fiber",
    validationLabel: "Fiber",
  },
  {
    defaultValue: "50",
    formLabel: "Sugar maximum",
    name: "sugar",
    validationLabel: "Sugar maximum",
  },
] as const;

export type SetupSubmission = {
  calorieTargetMilliKcal: number;
  carbohydrateTargetMilligrams: number;
  displayUnits: DisplayUnits;
  fatTargetMilligrams: number;
  fiberTargetMilligrams: number;
  proteinTargetMilligrams: number;
  sodiumMaximumMilligrams: number;
  sugarMaximumMilligrams: number;
  timeZone: string;
  waterTargetMicroliters: number;
};

export type SetupFields = {
  calories: string;
  carbohydrate: string;
  displayUnits: string;
  fat: string;
  fiber: string;
  protein: string;
  sodium: string;
  sugar: string;
  timeZone: string;
  water: string;
};

export type SetupValidationResult =
  | { data: SetupSubmission; success: true }
  | { error: string; field: keyof SetupFields; success: false };

const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,3})?$/;
const INTEGER_PATTERN = /^(?:0|[1-9]\d*)$/;

function parseThousandths(value: string): bigint | undefined {
  const candidate = value.trim();
  if (!DECIMAL_PATTERN.test(candidate)) return undefined;
  const [whole, fraction = ""] = candidate.split(".");
  return BigInt(whole) * 1_000n + BigInt(fraction.padEnd(3, "0"));
}

function boundedNumber(
  value: bigint | undefined,
  maximum: bigint,
): number | undefined {
  if (value === undefined || value < 1n || value > maximum) return undefined;
  return Number(value);
}

function roundDivide(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator / 2n) / denominator;
}

function canonicalTimeZone(value: string): string | undefined {
  const candidate = value.trim();
  if (!candidate || candidate.length > 100) return undefined;

  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: candidate })
      .resolvedOptions()
      .timeZone;
  } catch {
    return undefined;
  }
}

function failure(
  field: keyof SetupFields,
  error: string,
): SetupValidationResult {
  return { error, field, success: false };
}

export function validateSetupFields(
  fields: SetupFields,
): SetupValidationResult {
  const displayUnits = DISPLAY_UNITS.find(
    (candidate) => candidate === fields.displayUnits,
  );
  if (!displayUnits) {
    return failure("displayUnits", "Choose US or metric display units.");
  }

  const timeZone = canonicalTimeZone(fields.timeZone);
  if (!timeZone) {
    return failure(
      "timeZone",
      "Enter a valid IANA time zone, such as America/New_York.",
    );
  }

  const calories = boundedNumber(
    parseThousandths(fields.calories),
    SETUP_LIMITS.calories.maximumCanonical,
  );
  if (calories === undefined) {
    return failure("calories", "Calories must be from 0.001 to 20,000 kcal.");
  }

  const waterInput = parseThousandths(fields.water);
  const waterOption = WATER_UNIT_OPTIONS[displayUnits];
  if (
    boundedNumber(waterInput, waterOption.maximumThousandths) === undefined
  ) {
    return failure("water", waterOption.error);
  }
  const waterTargetMicroliters = Number(
    roundDivide(
      waterInput! * waterOption.canonicalNumerator,
      waterOption.canonicalDenominator,
    ),
  );

  const nutrients = new Map<
    (typeof SETUP_NUTRIENT_FIELDS)[number]["name"],
    number
  >();
  for (const field of SETUP_NUTRIENT_FIELDS) {
    const amount = boundedNumber(
      parseThousandths(fields[field.name]),
      SETUP_LIMITS.nutrient.maximumCanonical,
    );
    if (amount === undefined) {
      return failure(
        field.name,
        `${field.validationLabel} must be from 0.001 to 2,000 g.`,
      );
    }
    nutrients.set(field.name, amount);
  }

  const sodiumCandidate = fields.sodium.trim();
  const sodium = INTEGER_PATTERN.test(sodiumCandidate)
    ? boundedNumber(
        BigInt(sodiumCandidate),
        SETUP_LIMITS.sodium.maximumCanonical,
      )
    : undefined;
  if (sodium === undefined) {
    return failure("sodium", "Sodium maximum must be from 1 to 100,000 mg.");
  }

  return {
    data: {
      calorieTargetMilliKcal: calories,
      carbohydrateTargetMilligrams: nutrients.get("carbohydrate")!,
      displayUnits,
      fatTargetMilligrams: nutrients.get("fat")!,
      fiberTargetMilligrams: nutrients.get("fiber")!,
      proteinTargetMilligrams: nutrients.get("protein")!,
      sodiumMaximumMilligrams: sodium,
      sugarMaximumMilligrams: nutrients.get("sugar")!,
      timeZone,
      waterTargetMicroliters,
    },
    success: true,
  };
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
