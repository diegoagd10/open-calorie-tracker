import { data, Form, redirect } from "react-router";

import type { Route } from "./+types/settings.goals";
import { AppearanceSelector } from "../../appearance/selector";
import {
  getApplicationMutationSession,
  getSessionForApplicationAccess,
  readApplicationMutationForm,
} from "../../auth/http.server";
import shellStyles from "../../food-log.module.css";
import styles from "../../goals.module.css";
import { SettingsDestinations, SettingsShell } from "../../settings-destinations";
import { navigationToday } from "../../setup/runtime.server";
import {
  DailyGoalInputs,
  dailyGoalInputValues,
  dailyGoalTargetsFromForm,
} from "../components/daily-goal-inputs";
import { DailyGoalValidationError } from "../daily-goal.exceptions";
import type { DailyGoalTargets } from "../daily-goal.model";
import { getDailyGoalService } from "../runtime.server";

type GoalsActionData =
  | { error: { field: keyof DailyGoalTargets; message: string } }
  | { message: string };

export function meta() {
  return [
    { title: "Goals · Open Calorie Tracker" },
    {
      name: "description",
      content: "Set the private Daily Goal every Food Log day is measured against",
    },
  ];
}

export function headers() {
  return { "Cache-Control": "no-store" };
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await getSessionForApplicationAccess(request);
  if (!session) return redirect("/login");

  const goal = getDailyGoalService().read(session.user.id);
  if (!goal) return redirect("/setup");

  return {
    csrfToken: session.csrfToken,
    isAdministrator: session.user.role === "admin",
    today: navigationToday(session.user.id),
    username: session.user.username,
    values: dailyGoalInputValues(goal),
  };
}

/** Replaces the account's Daily Goal; a rejected target answers `400` naming its input. */
export async function action({ request }: Route.ActionArgs) {
  const session = await getApplicationMutationSession(request);
  if (session instanceof Response) return session;

  const formData = await readApplicationMutationForm(request, session);
  const service = getDailyGoalService();
  if (!service.read(session.user.id)) return redirect("/setup");

  try {
    service.save(session.user.id, dailyGoalTargetsFromForm(formData));
  } catch (error) {
    if (error instanceof DailyGoalValidationError) {
      return data<GoalsActionData>(
        { error: { field: error.field, message: error.message } },
        { status: 400 },
      );
    }
    throw error;
  }
  return data<GoalsActionData>({ message: "Daily Goal saved. Every day now uses it." });
}

export default function Goals({ actionData, loaderData }: Route.ComponentProps) {
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
            Every Food Log day, past and present, is measured against your Daily Goal.
          </p>
        </header>

        <SettingsDestinations
          active="goals"
          csrfToken={loaderData.csrfToken}
          isAdministrator={loaderData.isAdministrator}
        />

        <AppearanceSelector />

        <Form className={styles.settingsGroup} method="post" noValidate>
          <input name="csrfToken" type="hidden" value={loaderData.csrfToken} />
          <div className={styles.groupHeading}>
            <div>
              <h2>Daily Goal</h2>
              <p>Changes apply to every day as soon as you save.</p>
            </div>
          </div>

          <DailyGoalInputs
            error={actionData && "error" in actionData ? actionData.error : undefined}
            values={loaderData.values}
          />

          {actionData && "message" in actionData ? (
            <p className={styles.success} role="status">
              {actionData.message}
            </p>
          ) : null}

          <button className={styles.submit} type="submit">
            Save Daily Goal
          </button>
        </Form>
      </main>
      <aside className={shellStyles.desktopContext} aria-label="Daily Goal context">
        <div className={shellStyles.contextCard}>
          <span>Applies to</span>
          <strong>Every Food Log day</strong>
          <small>Private to {loaderData.username}</small>
        </div>
      </aside>
    </SettingsShell>
  );
}
