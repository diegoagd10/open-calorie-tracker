import {
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { z } from "zod";
import type { Route } from "./+types/home";
import {
  data,
  Form,
  Link,
  redirect,
  useFetcher,
} from "react-router";

import {
  getSessionForApplicationAccess,
  getApplicationMutationSession,
  readApplicationMutationForm,
} from "../auth/http.server";
import { DateRail } from "../date-rail";
import { AppNavigation } from "../app-navigation";
import { testRequestInstant } from "../runtime.server";
import { UiIcon } from "../ui-icon";
import { useWideLayout } from "./wide-layout";
import { getAuthenticationService } from "../auth/runtime.server";
import {
  buildCalendarMonth,
  formatLocalDate,
  getNearbyLocalDates,
} from "../shared/local-date";
import { DialogBackdrop, useModalDialog } from "../shared/modal-dialog";
import {
  type DailyCalories,
  FutureFoodLogDateError,
  InvalidFoodLogDateError,
} from "../food-log/food-log.server";
import { getFoodLogService } from "../food-log/runtime.server";
import { loadFoodEventDialogs } from "../food-event/index.server";
import {
  AddFoodDialog,
  CopyFoodEventDialog,
  editorHref,
  FOOD_EVENT_FETCHERS,
  FoodEventEditorDialog,
  FoodTimelineItem,
  formatEnergy,
  formatNutrient,
  PendingFoodTimelineItem,
} from "../food-event";
import {
  getWaterEventService,
  WaterEventNotFoundError,
} from "../water-event/index.server";
import {
  WaterDialog,
  waterEventLocalDateTime,
  WaterOverview,
  WaterTimelineItem,
} from "../water-event";
import styles from "../food-log.module.css";

/** The Food Log's own actions: opening the add food and add water dialogs for a day. */
function foodLogIntentSchema() {
  return z.object({ date: z.string(), intent: z.enum(["add-food", "add-water"]) });
}

function foodLogServiceForRequest(request: Request) {
  const instant = testRequestInstant(request);
  return instant ? getFoodLogService(instant) : getFoodLogService();
}

export function meta() {
  return [
    { title: "Open Calorie Tracker · Private application" },
    {
      name: "description",
      content: "Your private Open Calorie Tracker application space",
    },
  ];
}

export function headers() {
  return { "Cache-Control": "no-store" };
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await getSessionForApplicationAccess(request);

  if (!session) {
    return redirect(
      getAuthenticationService().isRegistrationOpen() ? "/register" : "/login",
    );
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

  const foodEvents = await loadFoodEventDialogs(
    { request, role: session.user.role, userId: session.user.id },
    foodLog,
  );
  if (foodEvents instanceof Response) return foodEvents;

  const nearbyDates = getNearbyLocalDates(foodLog.selectedDate, foodLog.today);
  const requestedCalendar = url.searchParams.get("calendar");
  const calendar = requestedCalendar
    ? buildCalendarMonth(requestedCalendar, foodLog.today, foodLog.selectedDate)
    : undefined;
  const summarizedDates = [
    ...nearbyDates.map((day) => day.date),
    ...(calendar?.days.map((day) => day.date) ?? []),
  ].filter((date) => date <= foodLog.today);
  const dailyCalories = foodLogServiceForRequest(request).dailyCalories(
    session.user.id,
    [...new Set(summarizedDates)],
    foodLog.goal,
  );

  const requestedWater = url.searchParams.get("water");
  let waterDialog:
    | {
        event?: ReturnType<ReturnType<typeof getWaterEventService>["read"]>;
        initialLocalLogDate: string;
        maxLocalLogDate: string;
      }
    | undefined;
  if (requestedWater !== null && !foodLog.isFuture) {
    const maxLocalLogDate = foodLog.localNow;
    const initialLocalLogDate = foodLog.selectedDate === foodLog.today
      ? foodLog.localNow
      : `${foodLog.selectedDate}T12:00`;
    if (requestedWater === "new") {
      waterDialog = { initialLocalLogDate, maxLocalLogDate };
    } else {
      const eventId = positiveIntegerId(requestedWater);
      try {
        const event = getWaterEventService(testRequestInstant(request)).read(
          session.user.id,
          eventId ?? 0,
        );
        if (
          waterEventLocalDateTime(event.logDate, foodLog.timeZone).slice(0, 10) !==
          foodLog.selectedDate
        ) {
          throw new WaterEventNotFoundError();
        }
        waterDialog = { event, initialLocalLogDate, maxLocalLogDate };
      } catch (error) {
        if (error instanceof WaterEventNotFoundError) {
          throw new Response(error.message, { status: 404 });
        }
        throw error;
      }
    }
  }

  return data(
    {
      ...foodEvents.dialogs,
      calendar,
      csrfToken: session.csrfToken,
      dailyCalories,
      foodLog,
      nearbyDates,
      notice: waterNotice(url.searchParams.get("notice")),
      username: session.user.username,
      waterDialog,
    },
    { status: foodEvents.status },
  );
}

function waterNotice(value: string | null): string | undefined {
  if (value === "water-updated") {
    return "Water Event updated. Daily total refreshed.";
  }
  if (value === "water-deleted") {
    return "Water Event deleted. Daily total updated.";
  }
  return undefined;
}

function positiveIntegerId(value: string | null): number | undefined {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 && String(id) === value
    ? id
    : undefined;
}

function formString(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

/** Opens the add food or add water dialog for a writable day. */
export async function action({ request }: Route.ActionArgs) {
  const session = await getApplicationMutationSession(request);
  if (session instanceof Response) return session;

  const formData = await readApplicationMutationForm(request, session);
  const parsed = foodLogIntentSchema().safeParse({
    date: formString(formData, "date"),
    intent: formString(formData, "intent"),
  });
  if (!parsed.success) {
    return data({ message: "The Food Log request was invalid." }, { status: 400 });
  }

  try {
    foodLogServiceForRequest(request).requireWritableDate(
      session.user.id,
      parsed.data.date,
    );
  } catch (error) {
    if (error instanceof FutureFoodLogDateError) {
      return data({ message: error.message }, { status: 422 });
    }
    if (error instanceof InvalidFoodLogDateError) {
      return data({ message: error.message }, { status: 400 });
    }
    throw error;
  }

  return redirect(
    `${foodLogHref(parsed.data.date)}&${parsed.data.intent === "add-food" ? "food=choose" : "water=new"}`,
  );
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

/** How a day's calories compare with the Daily Goal, for the week strip and calendar. */
function calorieDaySummary(summary: DailyCalories | undefined) {
  if (!summary || summary.eventCount === 0) return undefined;
  const kcal = Math.round(summary.knownMilliKcal / 1_000).toLocaleString("en-US");
  const goal = summary.goalMilliKcal;
  return {
    label: `${kcal} kcal${summary.isIncomplete ? " known" : ""}`,
    progress: goal ? `${Math.min(100, (summary.knownMilliKcal / goal) * 100).toFixed(1)}%` : undefined,
    // Known calories already past the goal are over; otherwise an incomplete day stays undecided.
    tone:
      goal === null
        ? "logged"
        : summary.knownMilliKcal > goal
          ? "over"
          : summary.isIncomplete
            ? "incomplete"
            : "within",
  } as const;
}

function CalendarView({
  calendar,
  dailyCalories,
  selectedDate,
}: {
  calendar: NonNullable<Route.ComponentProps["loaderData"]["calendar"]>;
  dailyCalories: Record<string, DailyCalories>;
  selectedDate: string;
}) {
  return (
    <section aria-labelledby="history-heading">
      <div className={styles.historyIntro}>
        <div>
          <h2 id="history-heading">History</h2>
          <p>
            Choose any past day. Every day is measured against your current
            Daily Goal.
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
            const calories = day.isFuture
              ? undefined
              : calorieDaySummary(dailyCalories[day.date]);
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
                aria-label={calories ? `${label}, ${calories.label}` : label}
                className={className}
                data-calorie-tone={calories?.tone}
                key={day.date}
                to={foodLogHref(day.date)}
              >
                <span>{day.day}</span>
                {calories ? (
                  <span className={styles.calendarCalories} aria-hidden="true">
                    <small>{calories.label}</small>
                    {calories.progress ? (
                      <span style={{ "--progress": calories.progress } as CSSProperties}>
                        <span />
                      </span>
                    ) : null}
                  </span>
                ) : null}
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}

function QuickLogActionForm({
  className,
  csrfToken,
  date,
  icon,
  intent,
  label,
  visibleLabel,
}: {
  className: string;
  csrfToken: string;
  date: string;
  icon: "plus" | "water";
  intent: "add-food" | "add-water";
  label: string;
  visibleLabel?: string;
}) {
  return (
    <Form method="post">
      <input name="csrfToken" type="hidden" value={csrfToken} />
      <input name="date" type="hidden" value={date} />
      <button
        aria-label={label}
        className={className}
        data-food-dialog-trigger={intent === "add-food" ? true : undefined}
        data-water-dialog-trigger={intent === "add-water" ? true : undefined}
        name="intent"
        title={label}
        type="submit"
        value={intent}
      >
        <UiIcon name={icon} />
        {visibleLabel ? <span>{visibleLabel}</span> : null}
      </button>
    </Form>
  );
}

function QuickLogActions({
  csrfToken,
  date,
  inline = false,
}: {
  csrfToken: string;
  date: string;
  inline?: boolean;
}) {
  return (
    <div
      aria-label={inline ? "Add to this day" : "Quick log"}
      className={inline ? `${styles.quickLogActions} ${styles.emptyDayActions}` : styles.quickLogActions}
      role="group"
    >
      <QuickLogActionForm
        className={`${styles.quickLogButton} ${styles.quickLogFood}`}
        csrfToken={csrfToken}
        date={date}
        icon="plus"
        intent="add-food"
        label="Add Food"
        visibleLabel="Add food"
      />
      <QuickLogActionForm
        className={`${styles.quickLogButton} ${styles.quickLogWater}`}
        csrfToken={csrfToken}
        date={date}
        icon="water"
        intent="add-water"
        label="Add Water"
        visibleLabel={inline ? "Add water" : undefined}
      />
    </div>
  );
}

function progressStyle(known: number, goal: number): CSSProperties {
  const percentage = Math.min(100, (known / goal) * 100);
  return { "--progress": `${percentage}%` } as CSSProperties;
}

type NutritionMetric = {
  goal: number | null;
  goalKind: "maximum" | "target";
  isIncomplete: boolean;
  key: string;
  known: number;
  label: string;
  unit: "g" | "mg";
};

function NutrientMetric({ metric }: { metric: NutritionMetric }) {
  const known = formatNutrient(metric.known, metric.unit);
  const goal =
    metric.goal === null
      ? null
      : formatNutrient(metric.goal, metric.unit);
  const knownDescription = metric.isIncomplete ? `${known} known` : known;
  const description =
    metric.goal === null
      ? `${metric.label}: ${knownDescription}; no active ${metric.goalKind}${metric.isIncomplete ? "; incomplete" : ""}`
      : `${metric.label}: ${knownDescription} of ${goal} ${metric.unit} ${metric.goalKind}${metric.isIncomplete ? "; incomplete" : ""}`;

  return (
    <article aria-label={description} className={styles.nutrientCell}>
      <span>
        {metric.label}
        {metric.goalKind === "maximum" ? " max" : ""}
      </span>
      <strong>
        {knownDescription}{" "}
        <small>
          {goal === null ? "/ No active goal" : `/ ${goal} ${metric.unit}`}
        </small>
      </strong>
      {metric.goal === null ? null : (
        <div
          aria-label={`${metric.label} progress`}
          aria-valuemax={
            metric.unit === "g" ? metric.goal / 1_000 : metric.goal
          }
          aria-valuemin={0}
          aria-valuenow={Math.min(
            metric.unit === "g" ? metric.known / 1_000 : metric.known,
            metric.unit === "g" ? metric.goal / 1_000 : metric.goal,
          )}
          aria-valuetext={description}
          className={styles.nutrientProgress}
          role="progressbar"
          style={progressStyle(metric.known, metric.goal)}
        >
          <span />
        </div>
      )}
      {metric.isIncomplete ? <em>Incomplete</em> : null}
    </article>
  );
}

function DailySummary({
  foodLog,
}: {
  foodLog: Route.ComponentProps["loaderData"]["foodLog"];
}) {
  const wideLayout = useWideLayout();
  const [nutrientDragX, setNutrientDragX] = useState(0);
  const [nutrientPage, setNutrientPage] = useState(0);
  const [nutrientSettling, setNutrientSettling] = useState(false);
  const nutrientSwipe = useRef<{
    isHorizontal: boolean;
    pointerId: number;
    startX: number;
    startY: number;
    width: number;
  } | null>(null);

  function startNutrientSwipe(event: ReactPointerEvent<HTMLElement>) {
    if (event.pointerType !== "touch") return;
    setNutrientSettling(false);
    nutrientSwipe.current = {
      isHorizontal: false,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      width: event.currentTarget.getBoundingClientRect().width,
    };
  }

  function moveNutrientSwipe(event: ReactPointerEvent<HTMLElement>) {
    const swipe = nutrientSwipe.current;
    if (!swipe || event.pointerId !== swipe.pointerId) return;

    const horizontalDistance = event.clientX - swipe.startX;
    const verticalDistance = event.clientY - swipe.startY;
    if (!swipe.isHorizontal) {
      if (
        Math.abs(horizontalDistance) < 6 &&
        Math.abs(verticalDistance) < 6
      ) {
        return;
      }
      if (Math.abs(horizontalDistance) <= Math.abs(verticalDistance)) {
        nutrientSwipe.current = null;
        return;
      }
      swipe.isHorizontal = true;
    }

    event.preventDefault();
    const minimum =
      nutrientPage === metricPages.length - 1 ? 0 : -swipe.width;
    const maximum = nutrientPage === 0 ? 0 : swipe.width;
    setNutrientDragX(
      Math.max(minimum, Math.min(maximum, horizontalDistance)),
    );
  }

  function cancelNutrientSwipe() {
    nutrientSwipe.current = null;
    setNutrientDragX(0);
    setNutrientSettling(true);
  }

  function finishNutrientSwipe(event: ReactPointerEvent<HTMLElement>) {
    const swipe = nutrientSwipe.current;
    nutrientSwipe.current = null;
    if (
      !swipe ||
      event.pointerId !== swipe.pointerId ||
      !swipe.isHorizontal
    ) {
      return;
    }

    const horizontalDistance = event.clientX - swipe.startX;
    const shouldChangePage =
      Math.abs(horizontalDistance) >= Math.min(64, swipe.width * 0.2);
    if (shouldChangePage) {
      setNutrientPage((page) =>
        horizontalDistance < 0
          ? Math.min(page + 1, metricPages.length - 1)
          : Math.max(page - 1, 0),
      );
    }
    setNutrientDragX(0);
    setNutrientSettling(true);
  }

  const goal = foodLog.goal;
  const totals = foodLog.nutritionTotals;
  const calorieTotal = totals.energyMilliKcal;
  const calorieGoal = goal?.calorieTarget;
  const calorieKnown = formatEnergy(calorieTotal.known);
  const calorieGoalDisplay = calorieGoal ? formatEnergy(calorieGoal) : undefined;
  const calorieDescription = calorieGoal
    ? `${calorieKnown}${calorieTotal.isIncomplete ? " known" : ""} of ${calorieGoalDisplay} kcal target${calorieTotal.isIncomplete ? "; incomplete" : ""}`
    : undefined;
  const metricPages: NutritionMetric[][] = [
    [
      {
        goal: goal?.proteinTarget ?? null,
        goalKind: "target",
        isIncomplete: totals.proteinMilligrams.isIncomplete,
        key: "protein",
        known: totals.proteinMilligrams.known,
        label: "Protein",
        unit: "g",
      },
      {
        goal: goal?.carbohydrateTarget ?? null,
        goalKind: "target",
        isIncomplete: totals.carbohydrateMilligrams.isIncomplete,
        key: "carbohydrate",
        known: totals.carbohydrateMilligrams.known,
        label: "Carbohydrate",
        unit: "g",
      },
      {
        goal: goal?.fatTarget ?? null,
        goalKind: "target",
        isIncomplete: totals.fatMilligrams.isIncomplete,
        key: "fat",
        known: totals.fatMilligrams.known,
        label: "Fat",
        unit: "g",
      },
    ],
    [
      {
        goal: goal?.fiberTarget ?? null,
        goalKind: "target",
        isIncomplete: totals.fiberMilligrams.isIncomplete,
        key: "fiber",
        known: totals.fiberMilligrams.known,
        label: "Fiber",
        unit: "g",
      },
      {
        goal: goal?.sugarMaximum ?? null,
        goalKind: "maximum",
        isIncomplete: totals.sugarMilligrams.isIncomplete,
        key: "sugar",
        known: totals.sugarMilligrams.known,
        label: "Sugar",
        unit: "g",
      },
      {
        goal: goal?.sodiumMaximum ?? null,
        goalKind: "maximum",
        isIncomplete: totals.sodiumMilligrams.isIncomplete,
        key: "sodium",
        known: totals.sodiumMilligrams.known,
        label: "Sodium",
        unit: "mg",
      },
    ],
  ];
  const nutrientTrackStyle = {
    transform: `translate3d(calc(${-nutrientPage * 50}% + ${nutrientDragX}px), 0, 0)`,
  } satisfies CSSProperties;

  return (
    <>
      <section
        aria-labelledby="calorie-heading"
        className={styles.summarySurface}
      >
        <div className={styles.calorieRow}>
          <h2 id="calorie-heading">Calories</h2>
          <p>
            <strong>
              {calorieKnown}
              {calorieTotal.isIncomplete ? " known" : ""}
            </strong>{" "}
            <span>
              {calorieGoal
                ? `/ ${calorieGoalDisplay} kcal`
                : "/ No active goal"}
            </span>
          </p>
          {calorieGoal ? (
            <div
              aria-label="Calorie progress"
              aria-valuemax={calorieGoal / 1_000}
              aria-valuemin={0}
              aria-valuenow={Math.min(
                calorieTotal.known / 1_000,
                calorieGoal / 1_000,
              )}
              aria-valuetext={calorieDescription}
              className={styles.linearProgress}
              role="progressbar"
              style={progressStyle(calorieTotal.known, calorieGoal)}
            >
              <span />
            </div>
          ) : null}
          <small>
            {calorieTotal.isIncomplete ? (
              <em className={styles.incompleteLabel}>Incomplete</em>
            ) : null}
            {calorieTotal.isIncomplete ? " · " : ""}
            {foodLog.foodEvents.length
              ? `${foodLog.foodEvents.length} Food ${foodLog.foodEvents.length === 1 ? "Entry" : "Entries"}`
              : "No Food Entries"}
          </small>
        </div>

        <section
          aria-label="Daily nutrient progress"
          className={styles.nutrientCarousel}
          onPointerCancel={cancelNutrientSwipe}
          onPointerDown={startNutrientSwipe}
          onPointerMove={moveNutrientSwipe}
          onPointerUp={finishNutrientSwipe}
        >
          <div
            className={`${styles.nutrientTrack} ${nutrientSettling ? styles.nutrientTrackSettling : ""}`}
            style={nutrientTrackStyle}
          >
            {metricPages.map((metrics, page) => (
              <div
                // Only a measured phone layout hides the off-screen page; desktop and
                // server-rendered markup keep every nutrient exposed.
                aria-hidden={wideLayout === false && nutrientPage !== page}
                className={styles.nutrientPage}
                key={page}
              >
                {metrics.map((metric) => (
                  <NutrientMetric key={metric.key} metric={metric} />
                ))}
              </div>
            ))}
          </div>
          {wideLayout === true ? null : (
            <div
              aria-label="Nutrition pages"
              className={styles.carouselControls}
              role="group"
            >
              <button
                aria-label="Show protein, carbohydrate, and fat"
                aria-pressed={nutrientPage === 0}
                className={`${styles.carouselDot} ${nutrientPage === 0 ? styles.activeCarouselDot : ""}`}
                onClick={() => {
                  setNutrientSettling(false);
                  setNutrientPage(0);
                }}
                type="button"
              />
              <button
                aria-label="Show fiber, sugar, and sodium"
                aria-pressed={nutrientPage === 1}
                className={`${styles.carouselDot} ${nutrientPage === 1 ? styles.activeCarouselDot : ""}`}
                onClick={() => {
                  setNutrientSettling(false);
                  setNutrientPage(1);
                }}
                type="button"
              />
            </div>
          )}
        </section>
      </section>

      <WaterOverview
        addHref={`${foodLogHref(foodLog.selectedDate)}&water=new`}
        goalOunces={goal?.waterTarget ?? null}
        totalOunces={foodLog.waterTotalOunces}
      />
    </>
  );
}

function WaterDialogModal({
  csrfToken,
  date,
  dialog,
}: {
  csrfToken: string;
  date: string;
  dialog: NonNullable<Route.ComponentProps["loaderData"]["waterDialog"]>;
}) {
  const closeHref = foodLogHref(date);
  const { closeDialog, dialogRef, handleDialogKeyDown } = useModalDialog({
    closeHref,
    initialFocusSelector: 'input:not([type="hidden"])',
    restoreFocusSelector:
      "[data-water-editor-trigger], [data-water-dialog-trigger]",
  });
  return (
    <DialogBackdrop onClose={closeDialog}>
      <WaterDialog
        actionHref="/water-events"
        closeHref={closeHref}
        csrfToken={csrfToken}
        dialogRef={dialogRef}
        event={dialog.event}
        initialLocalLogDate={dialog.initialLocalLogDate}
        maxLocalLogDate={dialog.maxLocalLogDate}
        onKeyDown={handleDialogKeyDown}
        returnDate={date}
      />
    </DialogBackdrop>
  );
}

export default function Home({ actionData, loaderData }: Route.ComponentProps) {
  const {
    addFood,
    barcodeLookup = "hidden",
    calendar,
    copy,
    copyError,
    csrfToken,
    dailyCalories = {},
    editor,
    foodLog,
    nearbyDates,
    notice,
    waterDialog,
  } = loaderData;
  const selectedLabel = fullDate(foodLog.selectedDate);
  const showQuickLog = !calendar && !foodLog.isFuture;
  // A catalog save shows a pending row in the log while the Add Food dialog waits, hidden.
  const addFoodFetcher = useFetcher({ key: FOOD_EVENT_FETCHERS.add });
  const addingMethod = addFoodFetcher.state === "idle" ? undefined : addFoodFetcher.formData?.get("method");
  const foodLogPending = addingMethod === "lookup" || addingMethod === "barcode";
  const pendingFoodName =
    addFood?.mode === "detail"
      ? addFood.food.name
      : addFood?.mode === "barcode" && addFood.food
        ? addFood.food.name
        : "Selected food";
  const message = actionData && "message" in actionData ? actionData.message : undefined;

  return (
    <>
      <div
        className={`${styles.shell} ${styles.foodLogShell}`}
        inert={
          (addFood && !foodLogPending) || editor || waterDialog || copy
            ? true
            : undefined
        }
      >
        <a className={styles.skipLink} href="#food-log-content">
          Skip to daily log
        </a>
        <AppNavigation
          active={calendar ? "history" : "log"}
          csrfToken={csrfToken}
          floatingActions={
            showQuickLog ? (
              <QuickLogActions
                csrfToken={csrfToken}
                date={foodLog.selectedDate}
              />
            ) : undefined
          }
          selectedDate={foodLog.selectedDate}
          today={foodLog.today}
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
          </header>

          {calendar ? (
            <CalendarView
              calendar={calendar}
              dailyCalories={dailyCalories}
              selectedDate={foodLog.selectedDate}
            />
          ) : (
            <section aria-label="Food Log" className={styles.foodLogLayout}>
              <DateRail
                key={foodLog.selectedDate}
                nearbyDates={nearbyDates.map((day) => ({
                  ...day,
                  calories: calorieDaySummary(dailyCalories[day.date]),
                }))}
                selectedDate={foodLog.selectedDate}
                today={foodLog.today}
              />

              <DailySummary foodLog={foodLog} />

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
                {copyError ? (
                  <p className={styles.catalogError} role="alert">
                    {copyError}
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
                ) : foodLog.events.length || foodLogPending ? (
                  <section className={styles.entryList} aria-label="Daily log entries">
                    {foodLogPending ? (
                      <PendingFoodTimelineItem name={pendingFoodName} />
                    ) : null}
                    {foodLog.events.map((event) => {
                      return event.kind === "food" ? (
                        <FoodTimelineItem
                          editHref={editorHref(foodLog.selectedDate, event.id)}
                          event={event}
                          icon={<UiIcon name="utensils" />}
                          key={`food-${event.id}`}
                          timeZone={foodLog.timeZone}
                        />
                      ) : (
                        <WaterTimelineItem
                          editHref={`${foodLogHref(foodLog.selectedDate)}&water=${event.id}`}
                          event={event}
                          icon={<UiIcon name="water" />}
                          key={`water-${event.id}`}
                          timeZone={foodLog.timeZone}
                        />
                      );
                    })}
                    {message ? (
                      <p className={styles.actionMessage} role="status">
                        {message}
                      </p>
                    ) : null}
                  </section>
                ) : (
                  <div className={styles.emptyDay}>
                    <span className={styles.emptyIcon} aria-hidden="true">
                      □
                    </span>
                    <h3>No entries for this day</h3>
                    <p>
                      {foodLog.selectedDate === foodLog.today
                        ? "Add food or water when you’re ready."
                        : "Past-day entries start at 12:00 PM. Add food or water when you’re ready."}
                    </p>
                    <QuickLogActions
                      csrfToken={csrfToken}
                      date={foodLog.selectedDate}
                      inline
                    />
                    {message ? (
                      <p className={styles.actionMessage} role="status">
                        {message}
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
      </div>
      {addFood ? (
        <AddFoodDialog
          barcodeLookup={barcodeLookup}
          csrfToken={csrfToken}
          date={foodLog.selectedDate}
          hidden={foodLogPending}
          stage={addFood}
        />
      ) : null}
      {editor ? (
        <FoodEventEditorDialog
          canCopy={editor.canCopy}
          csrfToken={csrfToken}
          date={foodLog.selectedDate}
          event={editor.event}
          key={editor.event.id}
        />
      ) : null}
      {waterDialog ? (
        <WaterDialogModal
          csrfToken={csrfToken}
          date={foodLog.selectedDate}
          dialog={waterDialog}
          key={waterDialog.event?.updatedAt ?? "create"}
        />
      ) : null}
      {copy ? (
        <CopyFoodEventDialog csrfToken={csrfToken} dialog={copy} />
      ) : null}
    </>
  );
}
