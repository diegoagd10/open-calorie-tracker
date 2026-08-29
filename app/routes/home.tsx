import { z } from "zod";
import type { Route } from "./+types/home";
import { data, Form, Link, redirect } from "react-router";

import {
  getAuthenticatedSession,
  requireValidOrigin,
  serializeClearedSessionCookie,
} from "../auth/http.server";
import { getAuthenticationService } from "../auth/runtime.server";
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
import { getGoalSetupService } from "../setup/runtime.server";
import styles from "../food-log.module.css";

const foodLogIntentSchema = z.object({
  date: z.string(),
  intent: z.enum(["add-food", "add-water"]),
});

type HomeActionData = { message: string };

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
    foodLog = getFoodLogService().read(
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

  const nearbyDates = getNearbyLocalDates(
    foodLog.selectedDate,
    foodLog.today,
  );
  const requestedCalendar = url.searchParams.get("calendar");
  const calendar = requestedCalendar
    ? buildCalendarMonth(
        requestedCalendar,
        foodLog.today,
        foodLog.selectedDate,
      )
    : undefined;

  return {
    calendar,
    csrfToken: session.csrfToken,
    foodLog,
    nearbyDates,
    username: session.user.username,
  };
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
    date: String(formData.get("date") ?? ""),
    intent: String(formData.get("intent") ?? ""),
  });
  if (!parsed.success) {
    return data<HomeActionData>(
      { message: "The Food Log request was invalid." },
      { status: 400 },
    );
  }

  try {
    getFoodLogService().requireWritableDate(session.user.id, parsed.data.date);
  } catch (error) {
    if (error instanceof FutureFoodLogDateError) {
      return data<HomeActionData>({ message: error.message }, { status: 422 });
    }
    if (error instanceof InvalidFoodLogDateError) {
      return data<HomeActionData>({ message: error.message }, { status: 400 });
    }
    throw error;
  }

  return data<HomeActionData>({
    message:
      parsed.data.intent === "add-food"
        ? "Food search will open here when the catalog flow is connected."
        : "Water entry will open here when the Water Log flow is connected.",
  });
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

function goalValues(
  foodLog: Route.ComponentProps["loaderData"]["foodLog"],
) {
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
          <p>Choose any past day. Goal Versions remain tied to their effective date.</p>
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

export default function Home({ actionData, loaderData }: Route.ComponentProps) {
  const { calendar, csrfToken, foodLog, nearbyDates, username } = loaderData;
  const goals = goalValues(foodLog);
  const selectedLabel = fullDate(foodLog.selectedDate);
  const view = calendar ? "calendar" : "log";

  return (
    <div className={styles.shell}>
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
            <h1 aria-label={calendar ? "Food Log history" : "Today's Food Log"}>
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
          <CalendarView calendar={calendar} selectedDate={foodLog.selectedDate} />
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
                      aria-label={`${weekday} ${dateNumber}`}
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
                      aria-label={`${weekday} ${dateNumber}`}
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
                  <strong>0</strong> <span>/ {goals.calorie} kcal</span>
                </p>
                <div className={styles.progress} aria-hidden="true" />
                <small>No Food Entries</small>
              </section>
              <section
                className={styles.summaryCard}
                aria-labelledby="water-heading"
              >
                <h2 id="water-heading">Water</h2>
                <p>
                  <strong>0</strong>{" "}
                  <span>/ {goals.water} {goals.waterUnit}</span>
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
              {foodLog.isFuture ? (
                <div className={styles.futureDay}>
                  <span className={styles.emptyIcon} aria-hidden="true">□</span>
                  <h2>Future day</h2>
                  <p>
                    You can review goals, but food and water can only be recorded
                    today or in the past.
                  </p>
                </div>
              ) : (
                <div className={styles.emptyDay}>
                  <span className={styles.emptyIcon} aria-hidden="true">□</span>
                  <h3>No entries for this day</h3>
                  <p>
                    {foodLog.selectedDate === foodLog.today
                      ? "Start today’s Food Log with food or water when you’re ready."
                      : "Past-day entries start at 12:00 PM. Add food or water when you’re ready."}
                  </p>
                  <div className={styles.emptyActions}>
                    <Form method="post">
                      <input name="csrfToken" type="hidden" value={csrfToken} />
                      <input name="date" type="hidden" value={foodLog.selectedDate} />
                      <button
                        className={styles.primaryButton}
                        name="intent"
                        type="submit"
                        value="add-food"
                      >
                        Add Food
                      </button>
                    </Form>
                    <Form method="post">
                      <input name="csrfToken" type="hidden" value={csrfToken} />
                      <input name="date" type="hidden" value={foodLog.selectedDate} />
                      <button
                        className={styles.secondaryButton}
                        name="intent"
                        type="submit"
                        value="add-water"
                      >
                        Add Water
                      </button>
                    </Form>
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
              Food Log date {foodLog.selectedDate} · Time zone {foodLog.timeZone}
            </p>
          </section>
        )}
      </main>
      <aside className={styles.desktopContext} aria-label="Selected day context">
        <div className={styles.contextCard}>
          <span>Selected day</span>
          <strong>{selectedLabel}</strong>
          <span>Calendar date</span>
          <strong>{foodLog.selectedDate}</strong>
          <small>{foodLog.timeZone}</small>
        </div>
      </aside>
    </div>
  );
}
