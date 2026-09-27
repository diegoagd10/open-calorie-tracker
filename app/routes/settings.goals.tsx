import { useState } from "react";
import { data, Form, redirect } from "react-router";

import type { Route } from "./+types/settings.goals";
import { AppearanceSelector } from "../appearance/selector";
import { SettingsDestinations, SettingsShell } from "../settings-destinations";
import {
  getSessionForApplicationAccess,
  getApplicationMutationSession,
  readApplicationMutationForm,
} from "../auth/http.server";
import shellStyles from "../food-log.module.css";
import styles from "../goals.module.css";
import {
  InvalidGoalVersionDateError,
} from "../goals/goal-version.server";
import { getGoalVersionService } from "../goals/runtime.server";
import {
  convertWaterDisplay,
  goalFieldsFromCanonical,
  validateGoalVersionFields,
  type GoalVersionFields,
} from "../goals/validation";
import {
  SETUP_LIMITS,
  SETUP_NUTRIENT_FIELDS,
  WATER_UNIT_OPTIONS,
} from "../setup/validation";
import { formatLocalDate } from "../food-log/date";

type GoalsActionData = {
  error?: string;
  field?: keyof GoalVersionFields;
  message?: string;
};

const goalFields = [
  {
    label: "Calories target",
    max: SETUP_LIMITS.calories.displayMaximum,
    name: "calories",
    qualifier: "target",
    unit: "kcal",
  },
  {
    label: "Water target",
    name: "water",
    qualifier: "target",
    unit: WATER_UNIT_OPTIONS.us.unit,
  },
  ...SETUP_NUTRIENT_FIELDS.map((field) => ({
    label: field.formLabel,
    max: SETUP_LIMITS.nutrient.displayMaximum,
    name: field.name,
    qualifier: field.name === "sugar" ? "maximum" : "target",
    unit: "g",
  })),
  {
    label: "Sodium maximum",
    max: SETUP_LIMITS.sodium.displayMaximum,
    name: "sodium",
    qualifier: "maximum",
    unit: "mg",
  },
] as const;

export function meta() {
  return [
    { title: "Goals · Open Calorie Tracker" },
    {
      name: "description",
      content: "Replace private goals from an effective local date",
    },
  ];
}

export function headers() {
  return { "Cache-Control": "no-store" };
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await getSessionForApplicationAccess(request);
  if (!session) return redirect("/login");

  const service = getGoalVersionService();
  const url = new URL(request.url);
  const requestedEffectiveDate = url.searchParams.get("effectiveDate");
  let current;
  try {
    current = service.read(
      session.user.id,
      requestedEffectiveDate ?? undefined,
    );
  } catch (error) {
    if (error instanceof InvalidGoalVersionDateError) {
      throw new Response(error.message, { status: 400 });
    }
    throw error;
  }
  if (!current?.goal) return redirect("/setup");

  const effectiveDate = requestedEffectiveDate ?? current.today;
  return {
    csrfToken: session.csrfToken,
    displayUnits: current.displayUnits,
    fields: goalFieldsFromCanonical(
      { ...current.goal, effectiveDate },
      current.displayUnits,
    ),
    goal: current.goal,
    goalHistory: service.history(session.user.id).map((version) => ({
      ...goalFieldsFromCanonical(version, current.displayUnits),
      lastDate: version.lastDate,
    })),
    isAdministrator: session.user.role === "admin",
    timeZone: current.timeZone,
    today: current.today,
    username: session.user.username,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const session = await getApplicationMutationSession(request);
  if (session instanceof Response) return session;

  const formData = await readApplicationMutationForm(request, session);

  const service = getGoalVersionService();
  const requestedEffectiveDate = new URL(request.url).searchParams.get(
    "effectiveDate",
  );
  const current = service.read(
    session.user.id,
    requestedEffectiveDate ?? undefined,
  );
  if (!current?.goal) return redirect("/setup");

  const fields = Object.fromEntries(
    [
      "calories",
      "carbohydrate",
      "displayUnits",
      "effectiveDate",
      "fat",
      "fiber",
      "protein",
      "sodium",
      "sugar",
      "water",
      "waterSourceUnits",
      "waterSourceValue",
    ].map((name) => [name, String(formData.get(name) ?? "")]),
  ) as GoalVersionFields;
  const parsed = validateGoalVersionFields(
    fields,
    current.timeZone,
    current.goal,
  );
  if (!parsed.success) {
    return data<GoalsActionData>(
      { error: parsed.error, field: parsed.field },
      { status: 400 },
    );
  }

  const { effectiveDate, ...replacement } = parsed.data;
  try {
    const result = service.replace(
      session.user.id,
      effectiveDate,
      replacement,
    );
    const dateLabel = formatLocalDate(effectiveDate, {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
    return data<GoalsActionData>({
      message: `Goal Version ${result === "created" ? "saved" : "replaced"} for ${dateLabel}.`,
    });
  } catch (error) {
    if (error instanceof InvalidGoalVersionDateError) {
      return data<GoalsActionData>(
        { error: error.message, field: "effectiveDate" },
        { status: 400 },
      );
    }
    throw error;
  }
}

export default function Goals({ actionData, loaderData }: Route.ComponentProps) {
  const [displayUnits, setDisplayUnits] = useState(loaderData.displayUnits);
  const [fields, setFields] = useState(loaderData.fields);
  const [waterSource, setWaterSource] = useState({
    units: loaderData.displayUnits,
    value: loaderData.fields.water,
  });

  function changeDisplayUnits(nextUnits: "metric" | "us") {
    setFields((currentFields) => ({
      ...currentFields,
      water:
        convertWaterDisplay(
          waterSource.value,
          waterSource.units,
          nextUnits,
        ) ?? currentFields.water,
    }));
    setDisplayUnits(nextUnits);
  }

  return (
    <SettingsShell
      active="goals"
      csrfToken={loaderData.csrfToken}
      isAdministrator={loaderData.isAdministrator}
      skipLabel="Skip to goal settings"
      skipTarget="goal-settings-content"
      today={loaderData.today}
    >
      <main className={shellStyles.appSurface} id="goal-settings-content">
        <header className={shellStyles.mobileHeader}>
          <div className={shellStyles.titleLine}>
            <h1>Settings</h1>
            <span className={shellStyles.privacyCue}>◈ Private</span>
          </div>
          <p className={shellStyles.selectedDateLabel}>
            Goals are effective-dated. Past Food Logs keep the values active on
            that day.
          </p>
        </header>

        <SettingsDestinations
          active="goals"
          csrfToken={loaderData.csrfToken}
          isAdministrator={loaderData.isAdministrator}
        />

        <AppearanceSelector />

        <Form className={styles.settingsGroup} method="post" noValidate>
          <input
            name="csrfToken"
            type="hidden"
            value={loaderData.csrfToken}
          />
          <input
            name="waterSourceUnits"
            type="hidden"
            value={waterSource.units}
          />
          <input
            name="waterSourceValue"
            type="hidden"
            value={waterSource.value}
          />
          <div className={styles.groupHeading}>
            <div>
              <h2>Display and goals</h2>
              <p>Changes apply from the effective local date.</p>
            </div>
          </div>

          <fieldset className={styles.segmentedField}>
            <legend>Display units</legend>
            <label>
              <input
                aria-describedby={
                  actionData?.field === "displayUnits"
                    ? "goal-settings-error"
                    : undefined
                }
                aria-invalid={
                  actionData?.field === "displayUnits" || undefined
                }
                checked={displayUnits === "us"}
                name="displayUnits"
                onChange={() => changeDisplayUnits("us")}
                type="radio"
                value="us"
              />
              <span>US</span>
            </label>
            <label>
              <input
                aria-describedby={
                  actionData?.field === "displayUnits"
                    ? "goal-settings-error"
                    : undefined
                }
                aria-invalid={
                  actionData?.field === "displayUnits" || undefined
                }
                checked={displayUnits === "metric"}
                name="displayUnits"
                onChange={() => changeDisplayUnits("metric")}
                type="radio"
                value="metric"
              />
              <span>Metric</span>
            </label>
          </fieldset>

          <label className={styles.fieldRow}>
            <span>
              Effective date
              <small>Today or a future date in {loaderData.timeZone}</small>
            </span>
            <input
              aria-describedby={
                actionData?.field === "effectiveDate"
                  ? "goal-settings-error"
                  : undefined
              }
              aria-invalid={
                actionData?.field === "effectiveDate" || undefined
              }
              min={loaderData.today}
              name="effectiveDate"
              onChange={(event) =>
                setFields((current) => ({
                  ...current,
                  effectiveDate: event.target.value,
                }))
              }
              required
              type="date"
              value={fields.effectiveDate}
            />
          </label>

          <div className={styles.goalGrid}>
            {goalFields.map((field) => (
              <label key={field.name}>
                <span>
                  {field.label.replace(` ${field.qualifier}`, "")} {" "}
                  <small>{field.qualifier}</small>
                </span>
                <span className={styles.numberInput}>
                  <input
                    aria-describedby={
                      actionData?.field === field.name
                        ? "goal-settings-error"
                        : undefined
                    }
                    aria-invalid={
                      actionData?.field === field.name || undefined
                    }
                    inputMode="decimal"
                    max={
                      field.name === "water"
                        ? WATER_UNIT_OPTIONS[displayUnits].displayMaximum
                        : field.max
                    }
                    min={field.name === "sodium" ? "1" : "0.001"}
                    name={field.name}
                    onChange={(event) => {
                      if (field.name === "water") {
                        setWaterSource({
                          units: displayUnits,
                          value: event.target.value,
                        });
                      }
                      setFields((current) => ({
                        ...current,
                        [field.name]: event.target.value,
                      }));
                    }}
                    required
                    step={field.name === "sodium" ? "1" : "0.001"}
                    type="number"
                    value={fields[field.name]}
                  />
                  <em>
                    {field.name === "water"
                      ? WATER_UNIT_OPTIONS[displayUnits].unit
                      : field.unit}
                  </em>
                </span>
              </label>
            ))}
          </div>

          {actionData?.error ? (
            <p className={styles.error} id="goal-settings-error" role="alert">
              {actionData.error}
            </p>
          ) : null}
          {actionData?.message ? (
            <p className={styles.success} role="status">
              {actionData.message}
            </p>
          ) : null}

          <button className={styles.submit} type="submit">
            Save goal version
          </button>
        </Form>

        <GoalHistory
          displayUnits={loaderData.displayUnits}
          today={loaderData.today}
          versions={loaderData.goalHistory}
        />
      </main>
      <aside
        className={shellStyles.desktopContext}
        aria-label="Goal Version context"
      >
        <div className={shellStyles.contextCard}>
          <span>Effective local date</span>
          <strong>{fields.effectiveDate}</strong>
          <span>Time zone</span>
          <strong>{loaderData.timeZone}</strong>
          <small>Private to {loaderData.username}</small>
        </div>
      </aside>
    </SettingsShell>
  );
}

function formatHistoryDate(date: string): string {
  return formatLocalDate(date, { day: "numeric", month: "short", year: "numeric" });
}

function GoalHistory({
  displayUnits,
  today,
  versions,
}: {
  displayUnits: "metric" | "us";
  today: string;
  versions: Route.ComponentProps["loaderData"]["goalHistory"];
}) {
  const waterUnit = WATER_UNIT_OPTIONS[displayUnits].unit;
  return (
    <section
      aria-labelledby="goal-history-heading"
      className={`${styles.settingsGroup} ${styles.goalHistory}`}
    >
      <div className={styles.groupHeading}>
        <div>
          <h2 id="goal-history-heading">Goal Versions</h2>
          <p>Each Food Log uses the version effective on its date.</p>
        </div>
      </div>
      <ol>
        {versions.map((version) => {
          const scheduled = version.effectiveDate > today;
          const current = !scheduled && (version.lastDate === null || version.lastDate >= today);
          return (
            <li key={version.effectiveDate}>
              <span className={styles.goalHistoryDates}>
                {version.lastDate
                  ? `${formatHistoryDate(version.effectiveDate)} – ${formatHistoryDate(version.lastDate)}`
                  : `From ${formatHistoryDate(version.effectiveDate)}`}
                {current ? (
                  <span className={styles.goalHistoryState}>Current</span>
                ) : scheduled ? (
                  <span className={styles.goalHistoryState} data-state="scheduled">Scheduled</span>
                ) : null}
              </span>
              <span className={styles.goalHistoryValues}>
                {version.calories} kcal · Protein {version.protein} g · Carbohydrate{" "}
                {version.carbohydrate} g · Fat {version.fat} g · Water {version.water}{" "}
                {waterUnit}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
