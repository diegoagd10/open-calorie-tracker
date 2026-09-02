import { data, Form, redirect } from "react-router";
import { useEffect, useState } from "react";

import type { Route } from "./+types/setup";
import {
  getAuthenticatedSession,
  requireValidOrigin,
  serializeClearedSessionCookie,
} from "../auth/http.server";
import { getAuthenticationService } from "../auth/runtime.server";
import styles from "../setup.module.css";
import { getGoalSetupService } from "../setup/runtime.server";
import {
  SETUP_LIMITS,
  SETUP_NUTRIENT_FIELDS,
  validateSetupFields,
  WATER_UNIT_OPTIONS,
  type SetupFields,
} from "../setup/validation";

type SetupActionData = {
  error: string;
  field: keyof SetupFields;
};

export function meta() {
  return [
    { title: "Set up your Food Log · Open Calory Tracker" },
    {
      name: "description",
      content: "Choose display units and set your initial Food Log goals",
    },
  ];
}

export function headers() {
  return { "Cache-Control": "no-store" };
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await getAuthenticatedSession(request);
  if (!session) return redirect("/login");
  if (getGoalSetupService().isComplete(session.user.id)) return redirect("/");

  return { csrfToken: session.csrfToken };
}

export async function action({ request }: Route.ActionArgs) {
  requireValidOrigin(request);
  const session = await getAuthenticatedSession(request);
  if (!session) {
    return redirect("/login", {
      headers: { "Set-Cookie": serializeClearedSessionCookie() },
    });
  }
  if (getGoalSetupService().isComplete(session.user.id)) return redirect("/");

  const formData = await request.formData();
  if (
    !getAuthenticationService().verifyCsrfToken(
      session.token,
      String(formData.get("csrfToken") ?? ""),
    )
  ) {
    throw new Response("CSRF token rejected.", { status: 403 });
  }

  const fields = Object.fromEntries(
    [
      "calories",
      "carbohydrate",
      "displayUnits",
      "fat",
      "fiber",
      "protein",
      "sodium",
      "sugar",
      "timeZone",
      "water",
    ].map((name) => [name, String(formData.get(name) ?? "")]),
  ) as SetupFields;
  const parsed = validateSetupFields(fields);
  if (!parsed.success) {
    return data<SetupActionData>(
      { error: parsed.error, field: parsed.field },
      { status: 400 },
    );
  }

  getGoalSetupService().completeInitial(session.user.id, parsed.data);
  return redirect("/");
}

const goalFields = [
  {
    label: "Calories target",
    max: SETUP_LIMITS.calories.displayMaximum,
    name: "calories",
    unit: "kcal",
    value: "2050",
  },
  {
    label: "Water target",
    name: "water",
    unit: WATER_UNIT_OPTIONS.us.unit,
    value: WATER_UNIT_OPTIONS.us.defaultValue,
  },
  ...SETUP_NUTRIENT_FIELDS.map((field) => ({
    label: field.formLabel,
    max: SETUP_LIMITS.nutrient.displayMaximum,
    name: field.name,
    unit: "g",
    value: field.defaultValue,
  })),
  {
    label: "Sodium maximum",
    max: SETUP_LIMITS.sodium.displayMaximum,
    name: "sodium",
    unit: "mg",
    value: "2300",
  },
] as const;

export default function Setup({ actionData, loaderData }: Route.ComponentProps) {
  const [displayUnits, setDisplayUnits] = useState<"metric" | "us">("us");
  const [timeZone, setTimeZone] = useState("UTC");
  const [water, setWater] = useState<string>(
    WATER_UNIT_OPTIONS.us.defaultValue,
  );

  // Stryker disable ArrayDeclaration: changing the constant dependency array cannot alter this one-time effect.
  useEffect(() => {
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);
  // Stryker restore ArrayDeclaration

  function changeDisplayUnits(nextUnits: "metric" | "us") {
    setDisplayUnits(nextUnits);
    setWater((current) => {
      if (
        !Object.values(WATER_UNIT_OPTIONS).some(
          (option) => option.defaultValue === current,
        )
      ) {
        return current;
      }
      return WATER_UNIT_OPTIONS[nextUnits].defaultValue;
    });
  }

  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="setup-heading">
        <div className={styles.progress} aria-hidden="true">
          <span />
          <span />
        </div>
        <header className={styles.header}>
          <h1 id="setup-heading">Set up your Food Log</h1>
          <strong className={styles.privacyCue}>Only what the log needs</strong>
          <p>No age, sex, height, weight, or health profile.</p>
        </header>

        <Form className={styles.form} method="post" noValidate>
          <input name="csrfToken" type="hidden" value={loaderData.csrfToken} />
          <fieldset className={styles.segmented}>
            <legend>Display units</legend>
            <label>
              <input
                aria-describedby={
                  actionData?.field === "displayUnits" ? "setup-error" : undefined
                }
                aria-invalid={actionData?.field === "displayUnits" || undefined}
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
                  actionData?.field === "displayUnits" ? "setup-error" : undefined
                }
                aria-invalid={actionData?.field === "displayUnits" || undefined}
                checked={displayUnits === "metric"}
                name="displayUnits"
                onChange={() => changeDisplayUnits("metric")}
                type="radio"
                value="metric"
              />
              <span>Metric</span>
            </label>
          </fieldset>

          <label className={styles.timeZoneField}>
            <span>Time zone</span>
            <input
              aria-describedby={
                actionData?.field === "timeZone"
                  ? "setup-error time-zone-help"
                  : "time-zone-help"
              }
              aria-invalid={actionData?.field === "timeZone" || undefined}
              name="timeZone"
              onChange={(event) => setTimeZone(event.target.value)}
              required
              value={timeZone}
            />
            <small id="time-zone-help">
              Use an IANA time zone such as America/New_York.
            </small>
          </label>

          <div className={styles.goalGrid}>
            {goalFields.map((field) => (
              <label key={field.name}>
                <span>{field.label}</span>
                <span className={styles.numberInput}>
                  <input
                    aria-describedby={
                      actionData?.field === field.name ? "setup-error" : undefined
                    }
                    aria-invalid={actionData?.field === field.name || undefined}
                    {...(field.name === "water"
                      ? {
                          max:
                            WATER_UNIT_OPTIONS[displayUnits].displayMaximum,
                          onChange: (event: React.ChangeEvent<HTMLInputElement>) =>
                            setWater(event.target.value),
                          value: water,
                        }
                      : { defaultValue: field.value, max: field.max })}
                    inputMode="decimal"
                    min={field.name === "sodium" ? "1" : "0.001"}
                    name={field.name}
                    required
                    step={field.name === "sodium" ? "1" : "0.001"}
                    type="number"
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
            <p className={styles.error} id="setup-error" role="alert">
              {actionData.error}
            </p>
          ) : null}

          <button className={styles.submit} type="submit">
            Finish setup
          </button>
        </Form>
      </section>
    </main>
  );
}
