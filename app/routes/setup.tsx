import { data, Form, redirect } from "react-router";
import { useEffect, useState } from "react";

import type { Route } from "./+types/setup";
import {
  getSessionForApplicationAccess,
  getApplicationMutationSession,
  readApplicationMutationForm,
} from "../auth/http.server";
import { DAILY_GOAL_DEFAULTS, DailyGoalInputs, dailyGoalTargetsFromForm } from "../daily-goal";
import { DailyGoalValidationError } from "../daily-goal/index.server";
import type { DailyGoalTargets } from "../daily-goal";
import styles from "../setup.module.css";
import { getSetupService } from "../setup/runtime.server";
import { SetupCompleteError, SetupValidationError } from "../setup/setup.exceptions";

type SetupActionData = {
  error: string;
  field: "timeZone" | keyof DailyGoalTargets;
};

export function meta() {
  return [
    { title: "Set up your Food Log · Open Calorie Tracker" },
    {
      name: "description",
      content: "Choose your time zone and set your Daily Goal",
    },
  ];
}

export function headers() {
  return { "Cache-Control": "no-store" };
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await getSessionForApplicationAccess(request);
  if (!session) return redirect("/login");
  if (getSetupService().isComplete(session.user.id)) return redirect("/");

  return { csrfToken: session.csrfToken };
}

/** Saves the time zone and first Daily Goal; a rejected field answers `400` naming it. */
export async function action({ request }: Route.ActionArgs) {
  const session = await getApplicationMutationSession(request);
  if (session instanceof Response) return session;
  if (getSetupService().isComplete(session.user.id)) return redirect("/");

  const formData = await readApplicationMutationForm(request, session);
  try {
    getSetupService().complete(session.user.id, {
      goal: dailyGoalTargetsFromForm(formData),
      timeZone: String(formData.get("timeZone") ?? ""),
    });
  } catch (error) {
    if (error instanceof SetupCompleteError) return redirect("/");
    if (error instanceof SetupValidationError || error instanceof DailyGoalValidationError) {
      return data<SetupActionData>({ error: error.message, field: error.field }, { status: 400 });
    }
    throw error;
  }
  return redirect("/");
}

export default function Setup({ actionData, loaderData }: Route.ComponentProps) {
  const [timeZone, setTimeZone] = useState("UTC");

  useEffect(() => {
    setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  }, []);

  const timeZoneError = actionData?.field === "timeZone" ? actionData.error : undefined;
  const goalError = actionData && actionData.field !== "timeZone"
    ? { field: actionData.field, message: actionData.error }
    : undefined;

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
          <label className={styles.timeZoneField}>
            <span>Time zone</span>
            <input
              aria-describedby={
                timeZoneError ? "setup-error time-zone-help" : "time-zone-help"
              }
              aria-invalid={timeZoneError ? true : undefined}
              name="timeZone"
              onChange={(event) => setTimeZone(event.target.value)}
              required
              value={timeZone}
            />
            <small id="time-zone-help">
              Use an IANA time zone such as America/New_York.
            </small>
          </label>
          {timeZoneError ? (
            <p className={styles.error} id="setup-error" role="alert">
              {timeZoneError}
            </p>
          ) : null}

          <DailyGoalInputs error={goalError} values={DAILY_GOAL_DEFAULTS} />

          <button className={styles.submit} type="submit">
            Finish setup
          </button>
        </Form>
      </section>
    </main>
  );
}
