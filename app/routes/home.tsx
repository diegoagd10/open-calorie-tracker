import { randomUUID } from "node:crypto";

import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { z } from "zod";
import type { Route } from "./+types/home";
import {
  data,
  Form,
  Link,
  redirect,
  useNavigate,
  useNavigation,
} from "react-router";

import {
  getAuthenticatedSession,
  requireValidOrigin,
  serializeClearedSessionCookie,
} from "../auth/http.server";
import { getAuthenticationService } from "../auth/runtime.server";
import {
  CatalogConfigurationError,
  CatalogCredentialsError,
  CatalogFoodNotFoundError,
  CatalogInvalidResponseError,
  CatalogRateLimitError,
  CatalogUnavailableError,
  CatalogUnsafeMeasurementError,
} from "../catalog/food-catalog.server";
import { getFoodCatalogProvider } from "../catalog/runtime.server";
import {
  addLocalDays,
  buildCalendarMonth,
  formatLocalDate,
  getNearbyLocalDates,
} from "../food-log/date";
import {
  FutureFoodLogDateError,
  InvalidFoodLogDateError,
} from "../food-log/food-log.server";
import { getFoodLogService } from "../food-log/runtime.server";
import {
  FoodEntryUnavailableError,
  InvalidFoodEntryInputError,
  StaleFoodEntryError,
} from "../food-entry/food-entry.server";
import { getFoodEntryService } from "../food-entry/runtime.server";
import {
  quantityMicrounitsFromDecimal,
  scaleCatalogNutrient,
  type NutrientStorageScale,
} from "../food-entry/nutrition";
import { getGoalSetupService } from "../setup/runtime.server";
import styles from "../food-log.module.css";

const foodLogIntentSchema = z.discriminatedUnion("intent", [
  z.object({ date: z.string(), intent: z.literal("add-food") }),
  z.object({ date: z.string(), intent: z.literal("add-water") }),
  z.object({
    date: z.string(),
    idempotencyKey: z.string(),
    intent: z.literal("log-food"),
    providerFoodId: z.string(),
    quantity: z.string(),
    selectedMeasurementId: z.string(),
  }),
  z.object({
    carbohydrateGrams: z.string(),
    date: z.string(),
    energyKcal: z.string(),
    entryId: z.string(),
    expectedUpdatedAt: z.string(),
    fatGrams: z.string(),
    fiberGrams: z.string(),
    intent: z.literal("update-food"),
    name: z.string(),
    proteinGrams: z.string(),
    quantity: z.string(),
    selectedMeasurementId: z.string(),
    sodiumMilligrams: z.string(),
    sugarGrams: z.string(),
  }),
  z.object({
    date: z.string(),
    entryId: z.string(),
    expectedUpdatedAt: z.string(),
    intent: z.literal("delete-food"),
  }),
]);
const catalogQuerySchema = z.string().trim().min(2).max(100);

type CurrentFoodEntry = ReturnType<
  ReturnType<typeof getFoodEntryService>["read"]
>;

type HomeActionData = {
  foodEntryEditor?: CurrentFoodEntry;
  message: string;
  tone?: "error" | "status";
};

function testRequestInstant(request: Request): Date | undefined {
  const requestedInstant =
    process.env.NODE_ENV === "test"
      ? request.headers.get("X-Test-Food-Log-Now")
      : undefined;
  if (!requestedInstant) return undefined;

  const instant = new Date(requestedInstant);
  if (Number.isNaN(instant.getTime())) {
    throw new Response("Test Food Log instant is invalid.", { status: 400 });
  }
  return instant;
}

function foodLogServiceForRequest(request: Request) {
  const instant = testRequestInstant(request);
  return instant ? getFoodLogService(instant) : getFoodLogService();
}

function catalogFailure(
  error: unknown,
): { message: string; status: number; title: string } | undefined {
  if (error instanceof CatalogConfigurationError) {
    return {
      message:
        "USDA search is not configured. Your saved Food Entries remain available.",
      status: 503,
      title: "USDA search is not configured",
    };
  }
  if (error instanceof CatalogCredentialsError) {
    return {
      message:
        "USDA search credentials are unavailable. Your saved Food Entries remain available.",
      status: 503,
      title: "USDA credentials unavailable",
    };
  }
  if (error instanceof CatalogRateLimitError) {
    return {
      message: "USDA rate limit reached. Wait a moment and search again.",
      status: 429,
      title: "USDA rate limit reached",
    };
  }
  if (error instanceof CatalogFoodNotFoundError) {
    return {
      message:
        "That USDA food is no longer available. Search again for a current result.",
      status: 409,
      title: "Food no longer available",
    };
  }
  if (error instanceof CatalogUnsafeMeasurementError) {
    return {
      message: "That food has no safe provider-backed measurement to log.",
      status: 422,
      title: "Measurement unavailable",
    };
  }
  if (error instanceof CatalogInvalidResponseError) {
    return {
      message: "USDA returned food data that could not be used safely.",
      status: 502,
      title: "USDA response could not be used",
    };
  }
  if (error instanceof CatalogUnavailableError) {
    return {
      message:
        "USDA is unavailable right now. Your saved Food Entries are unaffected.",
      status: 503,
      title: "USDA is unavailable",
    };
  }
  return undefined;
}

export function meta() {
  return [
    { title: "Open Calory Tracker · Private application" },
    {
      name: "description",
      content: "Your private Open Calory Tracker application space",
    },
  ];
}

export function headers() {
  return { "Cache-Control": "no-store" };
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await getAuthenticatedSession(request);

  if (!session) {
    return redirect("/login");
  }

  if (!getGoalSetupService().isComplete(session.user.id)) {
    return redirect("/setup");
  }

  const url = new URL(request.url);
  let foodLog;
  try {
    foodLog = foodLogServiceForRequest(request).read(
      session.user.id,
      url.searchParams.get("date") ?? undefined,
    );
  } catch (error) {
    if (error instanceof InvalidFoodLogDateError) {
      throw new Response(error.message, { status: 400 });
    }
    throw error;
  }
  if (!foodLog) return redirect("/setup");

  const nearbyDates = getNearbyLocalDates(foodLog.selectedDate, foodLog.today);
  const requestedCalendar = url.searchParams.get("calendar");
  const calendar = requestedCalendar
    ? buildCalendarMonth(requestedCalendar, foodLog.today, foodLog.selectedDate)
    : undefined;

  const requestedEntry = url.searchParams.get("entry");
  let foodEntryEditor;
  if (requestedEntry !== null && !foodLog.isFuture) {
    if (!/^[1-9]\d*$/.test(requestedEntry)) {
      throw new Response("Food Entry is unavailable.", { status: 404 });
    }
    try {
      foodEntryEditor = getFoodEntryService(testRequestInstant(request)).read(
        session.user.id,
        Number(requestedEntry),
      );
      if (foodEntryEditor.foodLogDate !== foodLog.selectedDate) {
        throw new FoodEntryUnavailableError();
      }
    } catch (error) {
      if (error instanceof FoodEntryUnavailableError) {
        throw new Response(error.message, { status: 404 });
      }
      throw error;
    }
  }

  const foodStage = catalogRouteState(url.searchParams.get("food"));
  const requestedQuery = url.searchParams.get("query") ?? "";
  let responseStatus = 200;
  let catalog:
    | {
        mode: "search";
        query: string;
        results: Awaited<
          ReturnType<ReturnType<typeof getFoodCatalogProvider>["search"]>
        >;
        message?: string;
        title?: string;
      }
    | {
        mode: "detail";
        query: string;
        food: Awaited<
          ReturnType<ReturnType<typeof getFoodCatalogProvider>["getFood"]>
        >;
        idempotencyKey: string;
      }
    | undefined;
  if (foodStage && !foodLog.isFuture) {
    if (foodStage.mode === "search") {
      const parsedQuery = catalogQuerySchema.safeParse(requestedQuery);
      if (!requestedQuery) {
        catalog = { mode: "search", query: "", results: [] };
      } else if (!parsedQuery.success) {
        responseStatus = 400;
        catalog = {
          message: "Enter a food search from 2 to 100 characters.",
          mode: "search",
          query: requestedQuery,
          results: [],
          title: "Search not sent",
        };
      } else {
        try {
          catalog = {
            mode: "search",
            query: parsedQuery.data,
            results: await getFoodCatalogProvider().search(parsedQuery.data),
          };
        } catch (error) {
          const failure = catalogFailure(error);
          if (!failure) throw error;
          responseStatus = failure.status;
          catalog = {
            message: failure.message,
            mode: "search",
            query: parsedQuery.data,
            results: [],
            title: failure.title,
          };
        }
      }
    } else {
      try {
        catalog = {
          food: await getFoodCatalogProvider().getFood(
            foodStage.providerFoodId,
          ),
          idempotencyKey: randomUUID(),
          mode: "detail",
          query: requestedQuery,
        };
      } catch (error) {
        const failure = catalogFailure(error);
        if (!failure) throw error;
        responseStatus = failure.status;
        catalog = {
          message: failure.message,
          mode: "search",
          query: requestedQuery,
          results: [],
          title: failure.title,
        };
      }
    }
  }

  return data(
    {
      calendar,
      catalog,
      csrfToken: session.csrfToken,
      foodEntryEditor,
      foodLog,
      nearbyDates,
      notice: noticeMessage(url.searchParams.get("notice")),
      username: session.user.username,
    },
    { status: responseStatus },
  );
}

function noticeMessage(value: string | null): string | undefined {
  if (value === "updated") {
    return "Food Entry updated. Daily totals refreshed.";
  }
  if (value === "deleted") {
    return "Food Entry deleted. Daily totals updated.";
  }
  return undefined;
}

type CatalogRouteState =
  | { mode: "detail"; providerFoodId: string }
  | { mode: "search" };

function catalogRouteState(
  value: string | null,
): CatalogRouteState | undefined {
  if (value === "search") return { mode: "search" };
  if (value && /^[1-9]\d*$/.test(value)) {
    return { mode: "detail", providerFoodId: value };
  }
  return undefined;
}

export async function action({ request }: Route.ActionArgs) {
  requireValidOrigin(request);
  const session = await getAuthenticatedSession(request);
  if (!session) {
    return redirect("/login", {
      headers: { "Set-Cookie": serializeClearedSessionCookie() },
    });
  }

  const formData = await request.formData();
  if (
    !getAuthenticationService().verifyCsrfToken(
      session.token,
      String(formData.get("csrfToken") ?? ""),
    )
  ) {
    throw new Response("CSRF token rejected.", { status: 403 });
  }

  const parsed = foodLogIntentSchema.safeParse({
    carbohydrateGrams: String(formData.get("carbohydrateGrams") ?? ""),
    date: String(formData.get("date") ?? ""),
    energyKcal: String(formData.get("energyKcal") ?? ""),
    entryId: String(formData.get("entryId") ?? ""),
    expectedUpdatedAt: String(formData.get("expectedUpdatedAt") ?? ""),
    fatGrams: String(formData.get("fatGrams") ?? ""),
    fiberGrams: String(formData.get("fiberGrams") ?? ""),
    idempotencyKey: String(formData.get("idempotencyKey") ?? ""),
    intent: String(formData.get("intent") ?? ""),
    name: String(formData.get("name") ?? ""),
    proteinGrams: String(formData.get("proteinGrams") ?? ""),
    providerFoodId: String(formData.get("providerFoodId") ?? ""),
    quantity: String(formData.get("quantity") ?? ""),
    selectedMeasurementId: String(formData.get("selectedMeasurementId") ?? ""),
    sodiumMilligrams: String(formData.get("sodiumMilligrams") ?? ""),
    sugarGrams: String(formData.get("sugarGrams") ?? ""),
  });
  if (!parsed.success) {
    return data<HomeActionData>(
      { message: "The Food Log request was invalid." },
      { status: 400 },
    );
  }

  try {
    foodLogServiceForRequest(request).requireWritableDate(
      session.user.id,
      parsed.data.date,
    );
  } catch (error) {
    if (error instanceof FutureFoodLogDateError) {
      return data<HomeActionData>({ message: error.message }, { status: 422 });
    }
    if (error instanceof InvalidFoodLogDateError) {
      return data<HomeActionData>({ message: error.message }, { status: 400 });
    }
    throw error;
  }

  if (parsed.data.intent === "add-food") {
    return redirect(`${foodLogHref(parsed.data.date)}&food=search`);
  }
  if (parsed.data.intent === "add-water") {
    return data<HomeActionData>({
      message:
        "Water entry will open here when the Water Log flow is connected.",
    });
  }

  if (
    parsed.data.intent === "update-food" ||
    parsed.data.intent === "delete-food"
  ) {
    const entryId = Number(parsed.data.entryId);
    const foodEntryService = getFoodEntryService(testRequestInstant(request));
    try {
      if (parsed.data.intent === "delete-food") {
        foodEntryService.delete(
          session.user.id,
          entryId,
          {
            expectedUpdatedAt: parsed.data.expectedUpdatedAt,
            foodLogDate: parsed.data.date,
          },
        );
        return redirect(`${foodLogHref(parsed.data.date)}&notice=deleted`);
      }
      foodEntryService.update(
        session.user.id,
        entryId,
        {
          carbohydrateGrams: parsed.data.carbohydrateGrams,
          energyKcal: parsed.data.energyKcal,
          expectedUpdatedAt: parsed.data.expectedUpdatedAt,
          fatGrams: parsed.data.fatGrams,
          fiberGrams: parsed.data.fiberGrams,
          foodLogDate: parsed.data.date,
          name: parsed.data.name,
          proteinGrams: parsed.data.proteinGrams,
          quantity: parsed.data.quantity,
          selectedMeasurementId: parsed.data.selectedMeasurementId,
          sodiumMilligrams: parsed.data.sodiumMilligrams,
          sugarGrams: parsed.data.sugarGrams,
        },
      );
      return redirect(`${foodLogHref(parsed.data.date)}&notice=updated`);
    } catch (error) {
      if (error instanceof FoodEntryUnavailableError) {
        return data<HomeActionData>(
          { message: error.message, tone: "error" },
          { status: 404 },
        );
      }
      if (error instanceof StaleFoodEntryError) {
        return data<HomeActionData>(
          {
            foodEntryEditor: foodEntryService.read(session.user.id, entryId),
            message: error.message,
            tone: "error",
          },
          { status: 409 },
        );
      }
      if (error instanceof InvalidFoodEntryInputError) {
        return data<HomeActionData>(
          { message: error.message, tone: "error" },
          { status: 400 },
        );
      }
      throw error;
    }
  }

  try {
    await getFoodEntryService(testRequestInstant(request)).log(
      session.user.id,
      {
        foodLogDate: parsed.data.date,
        idempotencyKey: parsed.data.idempotencyKey,
        providerFoodId: parsed.data.providerFoodId,
        quantity: parsed.data.quantity,
        selectedMeasurementId: parsed.data.selectedMeasurementId,
      },
    );
    return redirect(foodLogHref(parsed.data.date));
  } catch (error) {
    if (error instanceof FutureFoodLogDateError) {
      return data<HomeActionData>(
        { message: error.message, tone: "error" },
        { status: 422 },
      );
    }
    if (
      error instanceof InvalidFoodLogDateError ||
      error instanceof InvalidFoodEntryInputError
    ) {
      return data<HomeActionData>(
        { message: error.message, tone: "error" },
        { status: 400 },
      );
    }
    const failure = catalogFailure(error);
    if (failure) {
      return data<HomeActionData>(
        { message: failure.message, tone: "error" },
        { status: failure.status },
      );
    }
    throw error;
  }
}

function foodLogHref(date: string, calendar?: string): string {
  const parameters = new URLSearchParams({ date });
  if (calendar) parameters.set("calendar", calendar);
  return `/?${parameters}`;
}

function fullDate(date: string): string {
  return formatLocalDate(date, {
    day: "numeric",
    month: "long",
    weekday: "long",
    year: "numeric",
  });
}

function goalValues(foodLog: Route.ComponentProps["loaderData"]["foodLog"]) {
  const goal = foodLog.goal;
  if (!goal) {
    return {
      calorie: "—",
      water: "—",
      waterUnit: foodLog.displayUnits === "metric" ? "ml" : "fl oz",
    };
  }

  const calorie = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 3,
  }).format(goal.calorieTargetMilliKcal / 1_000);
  const waterAmount =
    foodLog.displayUnits === "metric"
      ? goal.waterTargetMicroliters / 1_000
      : goal.waterTargetMicroliters / 29_573.529_562_5;
  const water = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
  }).format(waterAmount);

  return {
    calorie,
    water,
    waterUnit: foodLog.displayUnits === "metric" ? "ml" : "fl oz",
  };
}

function Navigation({
  csrfToken,
  foodLog,
  username,
  view,
}: {
  csrfToken: string;
  foodLog: Route.ComponentProps["loaderData"]["foodLog"];
  username: string;
  view: "calendar" | "log";
}) {
  return (
    <>
      <aside className={styles.desktopRail} aria-label="Primary navigation">
        <div className={styles.railBrand}>
          <span className={styles.brandMark} aria-hidden="true">
            OC
          </span>
          <span>
            <strong>Open Calory</strong>
            <small>Private tracker</small>
          </span>
        </div>
        <nav className={styles.railNav}>
          <Link
            aria-current={view === "log" ? "page" : undefined}
            to={foodLogHref(foodLog.today)}
          >
            Today
          </Link>
          <Link
            aria-current={view === "calendar" ? "page" : undefined}
            to={foodLogHref(
              foodLog.selectedDate,
              foodLog.selectedDate.slice(0, 7),
            )}
          >
            History
          </Link>
        </nav>
        <div className={styles.railFooter}>
          <Link className={styles.railAccount} to="/account/password">
            <strong>Change password</strong>
            <small>Signed in as {username}</small>
          </Link>
          <Form action="/logout" method="post">
            <input name="csrfToken" type="hidden" value={csrfToken} />
            <button className={styles.logout} type="submit">
              Sign out
            </button>
          </Form>
        </div>
      </aside>
      <nav className={styles.mobileNav} aria-label="Primary navigation">
        <Link
          aria-current={view === "log" ? "page" : undefined}
          to={foodLogHref(foodLog.today)}
        >
          <span aria-hidden="true">▤</span>
          Log
        </Link>
        <Link
          aria-current={view === "calendar" ? "page" : undefined}
          to={foodLogHref(
            foodLog.selectedDate,
            foodLog.selectedDate.slice(0, 7),
          )}
        >
          <span aria-hidden="true">□</span>
          History
        </Link>
        <Link to="/account/password">
          <span aria-hidden="true">⚙</span>
          Account
        </Link>
      </nav>
    </>
  );
}

function CalendarView({
  calendar,
  selectedDate,
}: {
  calendar: NonNullable<Route.ComponentProps["loaderData"]["calendar"]>;
  selectedDate: string;
}) {
  return (
    <section aria-labelledby="history-heading">
      <div className={styles.historyIntro}>
        <div>
          <h2 id="history-heading">History</h2>
          <p>
            Choose any past day. Goal Versions remain tied to their effective
            date.
          </p>
        </div>
        <Link className={styles.backLink} to={foodLogHref(selectedDate)}>
          Back to Food Log
        </Link>
      </div>
      <div className={styles.calendarCard}>
        <div className={styles.calendarHead}>
          <Link
            aria-label="Previous month"
            className={styles.calendarNav}
            to={foodLogHref(selectedDate, calendar.previousMonth)}
          >
            ‹
          </Link>
          <strong>{calendar.label}</strong>
          {calendar.nextMonth ? (
            <Link
              aria-label="Next month"
              className={styles.calendarNav}
              to={foodLogHref(selectedDate, calendar.nextMonth)}
            >
              ›
            </Link>
          ) : (
            <button
              aria-label="Next month"
              className={styles.calendarNavDisabled}
              disabled
              type="button"
            >
              ›
            </button>
          )}
        </div>
        <div
          className={styles.calendarGrid}
          aria-label={`${calendar.label} calendar`}
        >
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
            <span className={styles.weekday} key={day}>
              {day}
            </span>
          ))}
          {Array.from({ length: calendar.leadingEmptyDays }, (_, index) => (
            <span aria-hidden="true" key={`empty-${index}`} />
          ))}
          {calendar.days.map((day) => {
            const label = formatLocalDate(day.date, {
              day: "numeric",
              month: "long",
              weekday: "long",
            });
            const className = [
              day.isFuture ? styles.calendarFuture : styles.calendarDay,
              day.isToday ? styles.calendarToday : "",
              day.isSelected ? styles.calendarSelected : "",
            ]
              .filter(Boolean)
              .join(" ");
            return day.isFuture ? (
              <button
                aria-label={label}
                className={className}
                disabled
                key={day.date}
                type="button"
              >
                {day.day}
              </button>
            ) : (
              <Link
                aria-current={day.isSelected ? "date" : undefined}
                aria-label={label}
                className={className}
                key={day.date}
                to={foodLogHref(day.date)}
              >
                {day.day}
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function EmptyActionForm({
  className,
  csrfToken,
  date,
  intent,
  label,
}: {
  className: string;
  csrfToken: string;
  date: string;
  intent: "add-food" | "add-water";
  label: string;
}) {
  return (
    <Form method="post">
      <input name="csrfToken" type="hidden" value={csrfToken} />
      <input name="date" type="hidden" value={date} />
      <button
        className={className}
        data-food-dialog-trigger={intent === "add-food" ? true : undefined}
        name="intent"
        type="submit"
        value={intent}
      >
        {label}
      </button>
    </Form>
  );
}

function catalogHref(date: string, food: string, query?: string): string {
  const parameters = new URLSearchParams({ date, food });
  if (query) parameters.set("query", query);
  return `/?${parameters}`;
}

function formatEnergy(value: number | null): string {
  if (value === null) return "—";
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(
    value / 1_000,
  );
}

function formatEventTime(value: string): string {
  const [hour, minute] = value.split(":").map(Number);
  const suffix = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;
  return `${displayHour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function FoodDetailStage({
  actionData,
  catalog,
  csrfToken,
  date,
}: {
  actionData: HomeActionData | undefined;
  catalog: Extract<
    NonNullable<Route.ComponentProps["loaderData"]["catalog"]>,
    { mode: "detail" }
  >;
  csrfToken: string;
  date: string;
}) {
  const { food } = catalog;
  const [measurementId, setMeasurementId] = useState(
    food.measurements[0]?.id ?? "",
  );
  const [quantity, setQuantity] = useState("1");
  const measurement =
    food.measurements.find((candidate) => candidate.id === measurementId) ??
    food.measurements[0];
  const numericQuantity = Number(quantity);
  const multiplier =
    measurement && Number.isFinite(numericQuantity) && numericQuantity > 0
      ? (measurement.baseQuantityMicrounits /
          food.authoritativeBaseQuantityMicrounits) *
        numericQuantity
      : 0;
  const preview = (
    value: (typeof food.nutritionPerAuthoritativeBase)["energyMilliKcal"],
    divisor: number,
    unit: string,
  ) =>
    value === null
      ? "Not reported"
      : `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format((value.amount * value.fixedPointMultiplier * multiplier) / divisor)} ${unit}`;

  return (
    <>
      <Link
        className={styles.backToResults}
        to={catalogHref(date, "search", catalog.query)}
      >
        ‹ Back to results
      </Link>
      <div className={styles.foodIdentity}>
        <span className={styles.catalogType}>{food.dataType}</span>
        <h3>{food.name}</h3>
        <p>
          USDA FoodData Central
          {food.brand ? ` · ${food.brand}` : ""}
        </p>
      </div>
      <div className={styles.snapshotNote}>
        <span aria-hidden="true">◇</span>
        <p>
          <strong>Saved as a Nutrition Snapshot</strong>
          This entry keeps these values and source details if USDA later changes
          or is unavailable.
        </p>
      </div>
      <Form className={styles.logFoodForm} method="post">
        <input name="csrfToken" type="hidden" value={csrfToken} />
        <input name="date" type="hidden" value={date} />
        <input
          name="idempotencyKey"
          type="hidden"
          value={catalog.idempotencyKey}
        />
        <input name="intent" type="hidden" value="log-food" />
        <input
          name="providerFoodId"
          type="hidden"
          value={food.providerFoodId}
        />
        <div className={styles.foodDetailGrid}>
          <label className={styles.stackedField}>
            <span>Measurement</span>
            <select
              name="selectedMeasurementId"
              onChange={(event) => setMeasurementId(event.currentTarget.value)}
              value={measurementId}
            >
              {food.measurements.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.label}
                </option>
              ))}
            </select>
            <small>Only provider-backed conversions are shown.</small>
          </label>
          <label className={styles.stackedField}>
            <span>Quantity</span>
            <input
              inputMode="decimal"
              max="99"
              min="0.01"
              name="quantity"
              onChange={(event) => setQuantity(event.currentTarget.value)}
              required
              step="0.01"
              type="number"
              value={quantity}
            />
          </label>
        </div>
        <dl className={styles.nutritionPreview}>
          <div>
            <dt>Calories</dt>
            <dd>
              {preview(
                food.nutritionPerAuthoritativeBase.energyMilliKcal,
                1_000,
                "kcal",
              )}
            </dd>
          </div>
          <div>
            <dt>Protein</dt>
            <dd>
              {preview(
                food.nutritionPerAuthoritativeBase.proteinMilligrams,
                1_000,
                "g",
              )}
            </dd>
          </div>
          <div>
            <dt>Carbohydrate</dt>
            <dd>
              {preview(
                food.nutritionPerAuthoritativeBase.carbohydrateMilligrams,
                1_000,
                "g",
              )}
            </dd>
          </div>
          <div>
            <dt>Fat</dt>
            <dd>
              {preview(
                food.nutritionPerAuthoritativeBase.fatMilligrams,
                1_000,
                "g",
              )}
            </dd>
          </div>
        </dl>
        {actionData?.message ? (
          <p className={styles.catalogError} role="alert">
            {actionData.message}
          </p>
        ) : null}
        <div className={styles.dialogActions}>
          <Link className={styles.secondaryButton} to={foodLogHref(date)}>
            Cancel
          </Link>
          <button className={styles.primaryButton} type="submit">
            Add to Food Log
          </button>
        </div>
      </Form>
    </>
  );
}

type EditableFoodEntry = NonNullable<
  Route.ComponentProps["loaderData"]["foodEntryEditor"]
>;

type FoodEntryFields = {
  carbohydrateGrams: string;
  energyKcal: string;
  fatGrams: string;
  fiberGrams: string;
  name: string;
  proteinGrams: string;
  quantity: string;
  selectedMeasurementId: string;
  sodiumMilligrams: string;
  sugarGrams: string;
};

function storedNutrientInput(
  value: number | null,
  storageScale: NutrientStorageScale,
) {
  if (value === null) return "";
  if (storageScale === "integer-milligrams") return String(value);
  const whole = Math.floor(value / 1_000);
  const fraction = String(value % 1_000)
    .padStart(3, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

function initialFoodEntryFields(entry: EditableFoodEntry): FoodEntryFields {
  return {
    carbohydrateGrams: storedNutrientInput(
      entry.carbohydrateMilligrams,
      "decimal-thousandths",
    ),
    energyKcal: storedNutrientInput(
      entry.energyMilliKcal,
      "decimal-thousandths",
    ),
    fatGrams: storedNutrientInput(
      entry.fatMilligrams,
      "decimal-thousandths",
    ),
    fiberGrams: storedNutrientInput(
      entry.fiberMilligrams,
      "decimal-thousandths",
    ),
    name: entry.name,
    proteinGrams: storedNutrientInput(
      entry.proteinMilligrams,
      "decimal-thousandths",
    ),
    quantity: String(entry.quantityMicrounits / 1_000_000),
    selectedMeasurementId: entry.selectedMeasurementId,
    sodiumMilligrams: storedNutrientInput(
      entry.sodiumMilligrams,
      "integer-milligrams",
    ),
    sugarGrams: storedNutrientInput(
      entry.sugarMilligrams,
      "decimal-thousandths",
    ),
  };
}

function recalculatedFoodEntryFields(
  entry: EditableFoodEntry,
  selectedMeasurementId: string,
  quantity: string,
): Partial<FoodEntryFields> {
  const measurement = entry.supportedMeasurements.find(
    (candidate) => candidate.id === selectedMeasurementId,
  );
  const quantityMicrounits = quantityMicrounitsFromDecimal(quantity);
  if (!measurement || quantityMicrounits === undefined) return {};
  const scale = (
    value: EditableFoodEntry["authoritativeNutrition"]["energyMilliKcal"],
  ) =>
    scaleCatalogNutrient(
      value,
      measurement.baseQuantityMicrounits,
      quantityMicrounits,
      entry.authoritativeBaseQuantityMicrounits,
    );
  return {
    carbohydrateGrams: storedNutrientInput(
      scale(entry.authoritativeNutrition.carbohydrateMilligrams),
      "decimal-thousandths",
    ),
    energyKcal: storedNutrientInput(
      scale(entry.authoritativeNutrition.energyMilliKcal),
      "decimal-thousandths",
    ),
    fatGrams: storedNutrientInput(
      scale(entry.authoritativeNutrition.fatMilligrams),
      "decimal-thousandths",
    ),
    fiberGrams: storedNutrientInput(
      scale(entry.authoritativeNutrition.fiberMilligrams),
      "decimal-thousandths",
    ),
    proteinGrams: storedNutrientInput(
      scale(entry.authoritativeNutrition.proteinMilligrams),
      "decimal-thousandths",
    ),
    sodiumMilligrams: storedNutrientInput(
      scale(entry.authoritativeNutrition.sodiumMilligrams),
      "integer-milligrams",
    ),
    sugarGrams: storedNutrientInput(
      scale(entry.authoritativeNutrition.sugarMilligrams),
      "decimal-thousandths",
    ),
  };
}

function FoodEntryEditorDialog({
  actionData,
  csrfToken,
  entry,
}: {
  actionData: HomeActionData | undefined;
  csrfToken: string;
  entry: EditableFoodEntry;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const navigation = useNavigation();
  const navigate = useNavigate();
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [fields, setFields] = useState(() => initialFoodEntryFields(entry));
  const closeHref = foodLogHref(entry.foodLogDate);
  const pending =
    navigation.state !== "idle" &&
    navigation.formData?.get("entryId") === String(entry.id);
  const pendingIntent = pending
    ? navigation.formData?.get("intent")
    : undefined;

  useEffect(() => {
    if (
      !previousFocusRef.current &&
      document.activeElement instanceof HTMLElement
    ) {
      previousFocusRef.current = document.activeElement;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = requestAnimationFrame(() => {
      dialogRef.current?.querySelector<HTMLElement>("input:not([disabled])")?.focus();
    });
    return () => {
      cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      const previousFocus = previousFocusRef.current;
      requestAnimationFrame(() => {
        const restoreTarget =
          previousFocus?.isConnected && previousFocus !== document.body
            ? previousFocus
            : document.querySelector<HTMLElement>("[data-entry-editor-trigger]");
        restoreTarget?.focus();
      });
    };
  }, []);

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      void navigate(closeHref);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [
      ...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), a[href]',
      ) ?? []),
    ].filter((element) => element.offsetParent !== null);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function changeScale(selectedMeasurementId: string, quantity: string) {
    setFields((current) => ({
      ...current,
      ...recalculatedFoodEntryFields(entry, selectedMeasurementId, quantity),
      quantity,
      selectedMeasurementId,
    }));
  }

  const nutrientFields = [
    ["energyKcal", "Calories (kcal)"],
    ["proteinGrams", "Protein (g)"],
    ["carbohydrateGrams", "Carbohydrate (g)"],
    ["fatGrams", "Fat (g)"],
    ["fiberGrams", "Fiber (g)"],
    ["sugarGrams", "Sugar (g)"],
    ["sodiumMilligrams", "Sodium (mg)"],
  ] as const;

  return (
    <div
      className={styles.dialogBackdrop}
      onClick={(event) => {
        if (event.target === event.currentTarget) void navigate(closeHref);
      }}
    >
      <section
        aria-labelledby="edit-food-entry-title"
        aria-modal="true"
        className={`${styles.foodDialog} ${styles.editFoodDialog}`}
        onKeyDown={handleDialogKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <div className={styles.dialogHead}>
          <div>
            <h2 id="edit-food-entry-title">Edit Food Entry</h2>
            <span className={styles.dialogChip}>Nutrition Snapshot</span>
            <p>Changes affect this occurrence only.</p>
          </div>
          <Link
            aria-label="Close edit form"
            className={styles.dialogClose}
            to={closeHref}
          >
            ×
          </Link>
        </div>
        <Form className={styles.editFoodForm} method="post" noValidate>
          <input name="csrfToken" type="hidden" value={csrfToken} />
          <input name="date" type="hidden" value={entry.foodLogDate} />
          <input name="entryId" type="hidden" value={entry.id} />
          <input
            name="expectedUpdatedAt"
            type="hidden"
            value={entry.updatedAt}
          />
          <fieldset disabled={pending}>
            <label className={styles.stackedField}>
              <span>Food name</span>
              <input
                maxLength={200}
                name="name"
                onChange={(event) =>
                  setFields((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                required
                value={fields.name}
              />
            </label>
            <div className={styles.foodDetailGrid}>
              <label className={styles.stackedField}>
                <span>Measurement</span>
                <select
                  name="selectedMeasurementId"
                  onChange={(event) =>
                    changeScale(event.target.value, fields.quantity)
                  }
                  value={fields.selectedMeasurementId}
                >
                  {entry.supportedMeasurements.map((measurement) => (
                    <option key={measurement.id} value={measurement.id}>
                      {measurement.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.stackedField}>
                <span>Quantity</span>
                <input
                  inputMode="decimal"
                  max="99"
                  min="0.000001"
                  name="quantity"
                  onChange={(event) =>
                    changeScale(fields.selectedMeasurementId, event.target.value)
                  }
                  required
                  step="0.000001"
                  type="number"
                  value={fields.quantity}
                />
              </label>
            </div>
            <div className={styles.editNutritionGrid}>
              {nutrientFields.map(([name, label]) => (
                <label className={styles.stackedField} key={name}>
                  <span>{label}</span>
                  <input
                    inputMode="decimal"
                    max={name === "sodiumMilligrams" ? "9999999" : "999999.999"}
                    min="0"
                    name={name}
                    onChange={(event) =>
                      setFields((current) => ({
                        ...current,
                        [name]: event.target.value,
                      }))
                    }
                    step={name === "sodiumMilligrams" ? "1" : "0.001"}
                    type="number"
                    value={fields[name]}
                  />
                </label>
              ))}
            </div>
            <p className={styles.authoritativeNote}>
              Quantity and measurement recalculate from the saved authoritative
              base, not from previously rounded values. Empty nutrients save as
              unknown; zero remains a known zero.
            </p>
            {actionData?.message ? (
              <p className={styles.catalogError} role="alert">
                {actionData.message}
              </p>
            ) : null}
            <div className={styles.editActions}>
              <button
                className={styles.dangerButton}
                onClick={() => setConfirmingDelete(true)}
                type="button"
              >
                Delete entry
              </button>
              <div>
                <Link className={styles.secondaryButton} to={closeHref}>
                  Cancel
                </Link>
                <button
                  className={styles.primaryButton}
                  name="intent"
                  type="submit"
                  value="update-food"
                >
                  {pendingIntent === "update-food"
                    ? "Saving…"
                    : "Save changes"}
                </button>
              </div>
            </div>
            {confirmingDelete ? (
              <div className={styles.deleteConfirm} role="alert">
                <div>
                  <strong>Delete this Food Entry?</strong>
                  <p>Its nutrition will no longer contribute to this day.</p>
                </div>
                <button
                  className={styles.secondaryButton}
                  onClick={() => setConfirmingDelete(false)}
                  type="button"
                >
                  Keep it
                </button>
                <button
                  className={styles.dangerSubmitButton}
                  formNoValidate
                  name="intent"
                  type="submit"
                  value="delete-food"
                >
                  {pendingIntent === "delete-food" ? "Deleting…" : "Delete"}
                </button>
              </div>
            ) : null}
          </fieldset>
        </Form>
      </section>
    </div>
  );
}

function CatalogDialog({
  actionData,
  catalog,
  csrfToken,
  date,
}: {
  actionData: HomeActionData | undefined;
  catalog: NonNullable<Route.ComponentProps["loaderData"]["catalog"]>;
  csrfToken: string;
  date: string;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const navigation = useNavigation();
  const navigate = useNavigate();
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [clientSearchMessage, setClientSearchMessage] = useState<string>();
  const searchPending = navigation.state !== "idle";
  const closeHref = foodLogHref(date);

  useEffect(() => {
    if (
      !previousFocusRef.current &&
      document.activeElement instanceof HTMLElement
    ) {
      previousFocusRef.current = document.activeElement;
    }
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = requestAnimationFrame(() => {
      const target = dialogRef.current?.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), button:not([disabled]), select:not([disabled]), a[href]',
      );
      target?.focus();
    });

    return () => {
      cancelAnimationFrame(focusFrame);
      document.body.style.overflow = previousOverflow;
      const previousFocus = previousFocusRef.current;
      requestAnimationFrame(() => {
        const restoreTarget =
          previousFocus?.isConnected && previousFocus !== document.body
            ? previousFocus
            : document.querySelector<HTMLElement>("[data-food-dialog-trigger]");
        restoreTarget?.focus();
      });
    };
  }, []);

  function handleDialogKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      void navigate(closeHref);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [
      ...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), a[href]',
      ) ?? []),
    ].filter((element) => element.offsetParent !== null);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  return (
    <div
      className={styles.dialogBackdrop}
      onClick={(event) => {
        if (event.target === event.currentTarget) void navigate(closeHref);
      }}
    >
      <section
        aria-labelledby="food-dialog-title"
        aria-modal="true"
        className={styles.foodDialog}
        onKeyDown={handleDialogKeyDown}
        ref={dialogRef}
        role="dialog"
      >
        <div className={styles.dialogHead}>
          <div>
            <h2 id="food-dialog-title">Add Food</h2>
            <span className={styles.dialogChip}>USDA catalog</span>
            <p>
              Search is deliberate. Nothing is logged until you confirm a
              measurement and quantity.
            </p>
          </div>
          <Link
            aria-label="Close food search"
            className={styles.dialogClose}
            to={closeHref}
          >
            ×
          </Link>
        </div>
        {catalog.mode === "detail" ? (
          <FoodDetailStage
            actionData={actionData}
            catalog={catalog}
            csrfToken={csrfToken}
            date={date}
          />
        ) : (
          <>
            <Form
              className={styles.searchForm}
              method="get"
              noValidate
              onSubmit={(event) => {
                const query = String(
                  new FormData(event.currentTarget).get("query") ?? "",
                );
                if (!catalogQuerySchema.safeParse(query).success) {
                  event.preventDefault();
                  setClientSearchMessage(
                    "Enter a trimmed food search from 2 to 100 characters.",
                  );
                  return;
                }
                setClientSearchMessage(undefined);
              }}
            >
              <input name="date" type="hidden" value={date} />
              <input name="food" type="hidden" value="search" />
              <label htmlFor="food-query">Search United States foods</label>
              <div className={styles.searchControl}>
                <input
                  autoComplete="off"
                  autoFocus
                  aria-describedby={
                    clientSearchMessage ? "food-search-error" : undefined
                  }
                  aria-invalid={clientSearchMessage ? true : undefined}
                  defaultValue={catalog.query}
                  id="food-query"
                  maxLength={100}
                  minLength={2}
                  name="query"
                  placeholder="Try Greek yogurt"
                  required
                  type="search"
                />
                <button className={styles.primaryButton} type="submit">
                  Search
                </button>
              </div>
            </Form>
            {searchPending ? (
              <div className={styles.catalogState} role="status">
                <h3>Searching USDA FoodData Central</h3>
                <p>Your deliberate catalog request is in progress.</p>
              </div>
            ) : clientSearchMessage ? (
              <div
                className={styles.catalogState}
                id="food-search-error"
                role="alert"
              >
                <h3>Search not sent</h3>
                <p>{clientSearchMessage}</p>
              </div>
            ) : catalog.message ? (
              <div className={styles.catalogState} role="alert">
                <h3>{catalog.title ?? "Search unavailable"}</h3>
                <p>{catalog.message}</p>
              </div>
            ) : catalog.results.length ? (
              <div
                className={styles.catalogResults}
                aria-label="USDA search results"
              >
                {catalog.results.map((result) => {
                  const identity = (
                    <span>
                      <span className={styles.catalogType}>
                        {result.dataType}
                      </span>
                      <strong>{result.name}</strong>
                      <small>
                        {[result.brand, result.measurementSummary]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </span>
                  );
                  return result.isSelectable ? (
                    <Link
                      key={result.providerFoodId}
                      to={catalogHref(
                        date,
                        result.providerFoodId,
                        catalog.query,
                      )}
                    >
                      {identity}
                      <small>Select ›</small>
                    </Link>
                  ) : (
                    <div aria-disabled="true" key={result.providerFoodId}>
                      {identity}
                      <small>Hidden in production</small>
                    </div>
                  );
                })}
              </div>
            ) : catalog.query ? (
              <div className={styles.catalogState} role="status">
                <h3>No foods found</h3>
                <p>
                  Try a broader product or ingredient name. Your Food Log was
                  not changed.
                </p>
              </div>
            ) : (
              <div className={styles.catalogState}>
                <h3>Find a food</h3>
                <p>
                  Results can include Branded, Survey/FNDDS, and Foundation
                  foods.
                </p>
              </div>
            )}
            <p className={styles.providerAttribution}>
              Food data from{" "}
              <a
                href="https://fdc.nal.usda.gov/"
                rel="noreferrer"
                target="_blank"
              >
                USDA FoodData Central
              </a>
            </p>
          </>
        )}
      </section>
    </div>
  );
}

export default function Home({ actionData, loaderData }: Route.ComponentProps) {
  const {
    calendar,
    catalog,
    csrfToken,
    foodEntryEditor,
    foodLog,
    nearbyDates,
    notice,
    username,
  } = loaderData;
  const activeFoodEntryEditor =
    actionData?.foodEntryEditor ?? foodEntryEditor;
  const goals = goalValues(foodLog);
  const selectedLabel = fullDate(foodLog.selectedDate);
  const view = calendar ? "calendar" : "log";
  const totalEnergyMilliKcal = foodLog.entries.reduce(
    (total, entry) => total + (entry.energyMilliKcal ?? 0),
    0,
  );

  return (
    <>
      <div
        className={styles.shell}
        inert={catalog || activeFoodEntryEditor ? true : undefined}
      >
        <a className={styles.skipLink} href="#food-log-content">
          Skip to daily log
        </a>
        <Navigation
          csrfToken={csrfToken}
          foodLog={foodLog}
          username={username}
          view={view}
        />
        <main className={styles.appSurface} id="food-log-content">
          <header className={styles.mobileHeader}>
            <div className={styles.titleLine}>
              <h1
                aria-label={
                  calendar
                    ? "Food Log history"
                    : foodLog.selectedDate === foodLog.today
                      ? "Today's Food Log"
                      : `Food Log for ${selectedLabel}`
                }
              >
                {calendar
                  ? "History"
                  : foodLog.selectedDate === foodLog.today
                    ? "Today"
                    : "Food Log"}
              </h1>
              <span className={styles.privacyCue}>◈ Private</span>
            </div>
            <p className={styles.selectedDateLabel}>{selectedLabel}</p>
          </header>

          {calendar ? (
            <CalendarView
              calendar={calendar}
              selectedDate={foodLog.selectedDate}
            />
          ) : (
            <section aria-label="Food Log">
              <div className={styles.dateRailWrap}>
                <Link
                  aria-label="Browse past dates"
                  className={styles.dateArrow}
                  to={foodLogHref(addLocalDays(foodLog.selectedDate, -7))}
                >
                  ‹
                </Link>
                <div className={styles.dateRail} aria-label="Nearby dates">
                  {nearbyDates.map((day) => {
                    const weekday = formatLocalDate(day.date, {
                      weekday: "short",
                    });
                    const dateNumber = formatLocalDate(day.date, {
                      day: "numeric",
                    });
                    return day.isFuture ? (
                      <button
                        className={styles.futureDate}
                        disabled
                        key={day.date}
                        type="button"
                      >
                        <small>{weekday}</small>
                        <strong>{dateNumber}</strong>
                      </button>
                    ) : (
                      <Link
                        aria-current={day.isSelected ? "date" : undefined}
                        className={`${styles.dateButton} ${day.isSelected ? styles.selectedDate : ""}`}
                        key={day.date}
                        to={foodLogHref(day.date)}
                      >
                        <small>{weekday}</small>
                        <strong>{dateNumber}</strong>
                      </Link>
                    );
                  })}
                </div>
                <Link
                  aria-label="Open calendar"
                  className={styles.dateArrow}
                  to={foodLogHref(
                    foodLog.selectedDate,
                    foodLog.selectedDate.slice(0, 7),
                  )}
                >
                  ›
                </Link>
              </div>

              <div className={styles.summaryGrid}>
                <section
                  className={styles.summaryCard}
                  aria-labelledby="calorie-heading"
                >
                  <h2 id="calorie-heading">Calories</h2>
                  <p>
                    <strong>{formatEnergy(totalEnergyMilliKcal)}</strong>{" "}
                    <span>/ {goals.calorie} kcal</span>
                  </p>
                  <div className={styles.progress} aria-hidden="true" />
                  <small>
                    {foodLog.entries.length
                      ? `${foodLog.entries.length} Food ${foodLog.entries.length === 1 ? "Entry" : "Entries"}`
                      : "No Food Entries"}
                  </small>
                </section>
                <section
                  className={styles.summaryCard}
                  aria-labelledby="water-heading"
                >
                  <h2 id="water-heading">Water</h2>
                  <p>
                    <strong>0</strong>{" "}
                    <span>
                      / {goals.water} {goals.waterUnit}
                    </span>
                  </p>
                  <div className={styles.progress} aria-hidden="true" />
                  <small>No Water Events</small>
                </section>
              </div>

              <section
                className={styles.timelineSection}
                aria-labelledby="daily-log-heading"
              >
                <div className={styles.sectionHeading}>
                  <h2 id="daily-log-heading">Daily log</h2>
                  <span>{selectedLabel}</span>
                </div>
                {notice ? (
                  <p className={styles.actionMessage} role="status">
                    {notice}
                  </p>
                ) : null}
                {foodLog.isFuture ? (
                  <div className={styles.futureDay}>
                    <span className={styles.emptyIcon} aria-hidden="true">
                      □
                    </span>
                    <h2>Future day</h2>
                    <p>
                      You can review goals, but food and water can only be
                      recorded today or in the past.
                    </p>
                  </div>
                ) : foodLog.entries.length ? (
                  <div className={styles.timeline}>
                    <EmptyActionForm
                      className={styles.timelineAddFood}
                      csrfToken={csrfToken}
                      date={foodLog.selectedDate}
                      intent="add-food"
                      label="＋ Add Food"
                    />
                    {foodLog.entries.map((entry) => (
                      <article key={entry.id}>
                        <Link
                          className={styles.foodEntryCard}
                          data-entry-editor-trigger
                          to={`${foodLogHref(entry.foodLogDate)}&entry=${entry.id}`}
                        >
                          <time
                            dateTime={`${entry.foodLogDate}T${entry.localEventTime}`}
                          >
                            {formatEventTime(entry.localEventTime)}
                          </time>
                          <span
                            className={styles.foodEntryMarker}
                            aria-hidden="true"
                          >
                            ◇
                          </span>
                          <span className={styles.foodEntryContent}>
                            <strong>{entry.name}</strong>
                            <small>
                              USDA FoodData Central · {entry.dataType}
                            </small>
                            <small>
                              {entry.selectedMeasurementLabel} ×{" "}
                              {entry.quantityMicrounits / 1_000_000}
                            </small>
                          </span>
                          <span className={styles.foodEntryEnergy}>
                            {formatEnergy(entry.energyMilliKcal)}{" "}
                            <small>kcal</small>
                          </span>
                        </Link>
                      </article>
                    ))}
                    <EmptyActionForm
                      className={styles.timelineAddWater}
                      csrfToken={csrfToken}
                      date={foodLog.selectedDate}
                      intent="add-water"
                      label="＋ Add Water"
                    />
                    {actionData?.message ? (
                      <p className={styles.actionMessage} role="status">
                        {actionData.message}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <div className={styles.emptyDay}>
                    <span className={styles.emptyIcon} aria-hidden="true">
                      □
                    </span>
                    <h3>No entries for this day</h3>
                    <p>
                      {foodLog.selectedDate === foodLog.today
                        ? "Start today’s Food Log with food or water when you’re ready."
                        : "Past-day entries start at 12:00 PM. Add food or water when you’re ready."}
                    </p>
                    <div className={styles.emptyActions}>
                      <EmptyActionForm
                        className={styles.primaryButton}
                        csrfToken={csrfToken}
                        date={foodLog.selectedDate}
                        intent="add-food"
                        label="Add Food"
                      />
                      <EmptyActionForm
                        className={styles.secondaryButton}
                        csrfToken={csrfToken}
                        date={foodLog.selectedDate}
                        intent="add-water"
                        label="Add Water"
                      />
                    </div>
                    {actionData?.message ? (
                      <p className={styles.actionMessage} role="status">
                        {actionData.message}
                      </p>
                    ) : null}
                  </div>
                )}
              </section>
              <p className={styles.dateNote}>
                Food Log date {foodLog.selectedDate} · Time zone{" "}
                {foodLog.timeZone}
              </p>
            </section>
          )}
        </main>
        <aside
          className={styles.desktopContext}
          aria-label="Selected day context"
        >
          <div className={styles.contextCard}>
            <span>Selected day</span>
            <strong>{selectedLabel}</strong>
            <span>Calendar date</span>
            <strong>{foodLog.selectedDate}</strong>
            <small>{foodLog.timeZone}</small>
          </div>
        </aside>
      </div>
      {catalog ? (
        <CatalogDialog
          actionData={actionData}
          catalog={catalog}
          csrfToken={csrfToken}
          date={foodLog.selectedDate}
        />
      ) : null}
      {activeFoodEntryEditor ? (
        <FoodEntryEditorDialog
          actionData={actionData}
          csrfToken={csrfToken}
          entry={activeFoodEntryEditor}
          key={activeFoodEntryEditor.updatedAt}
        />
      ) : null}
    </>
  );
}
