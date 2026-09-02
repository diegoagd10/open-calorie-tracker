import { data, Form } from "react-router";

import { AppNavigation } from "../app-navigation";
import type { Route } from "./+types/settings.users";
import {
  requireAdministratorSession,
  requireValidOrigin,
} from "../auth/http.server";
import { getAuthenticationService } from "../auth/runtime.server";
import { registrationSchema } from "../auth/validation";
import { formatLocalDate } from "../food-log/date";
import shellStyles from "../food-log.module.css";
import { SettingsDestinations } from "../settings-destinations";
import styles from "../users.module.css";

type UsersActionData = {
  created?: string;
  error?: string;
  username?: string;
};

export function meta() {
  return [
    { title: "Users · Open Calory Tracker" },
    {
      name: "description",
      content: "Manage member access without exposing private nutrition data",
    },
  ];
}

export function headers() {
  return { "Cache-Control": "no-store" };
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireAdministratorSession(request);
  return {
    csrfToken: session.csrfToken,
    members: getAuthenticationService().listManageableMembers(),
    today: new Date().toISOString().slice(0, 10),
    username: session.user.username,
  };
}

export async function action({ request }: Route.ActionArgs) {
  requireValidOrigin(request);
  const session = await requireAdministratorSession(request);
  const formData = await request.formData();
  const authentication = getAuthenticationService();
  if (
    !authentication.verifyCsrfToken(
      session.token,
      String(formData.get("csrfToken") ?? ""),
    )
  ) {
    throw new Response("CSRF token rejected.", { status: 403 });
  }

  const fields = {
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
    password: String(formData.get("password") ?? ""),
    username: String(formData.get("username") ?? ""),
  };
  const parsed = registrationSchema.safeParse(fields);
  if (!parsed.success) {
    const field = parsed.error.issues[0].path[0];
    const error =
      field === "username"
        ? "Use 3–30 ASCII letters, digits, dot, hyphen, or underscore."
        : field === "password"
          ? "Password must contain 12–128 characters."
          : "Passwords do not match.";
    return data<UsersActionData>(
      { error, username: fields.username },
      { status: 400 },
    );
  }

  const result = await authentication.provisionMember(
    parsed.data.username,
    parsed.data.password,
  );
  if (!result.ok) {
    return data<UsersActionData>(
      {
        error: "That username is already in use.",
        username: fields.username,
      },
      { status: 409 },
    );
  }

  return data<UsersActionData>(
    { created: result.member.username },
    { status: 201 },
  );
}

export default function Users({ actionData, loaderData }: Route.ComponentProps) {
  return (
    <div className={shellStyles.shell}>
      <a className={shellStyles.skipLink} href="#member-directory-content">
        Skip to member directory
      </a>
      <AppNavigation
        active="settings"
        csrfToken={loaderData.csrfToken}
        selectedDate={loaderData.today}
        today={loaderData.today}
        username={loaderData.username}
      />
      <main className={shellStyles.appSurface} id="member-directory-content">
        <header className={shellStyles.mobileHeader}>
          <div className={shellStyles.titleLine}>
            <h1>Users</h1>
            <span className={shellStyles.privacyCue}>◈ Accounts only</span>
          </div>
          <p className={shellStyles.selectedDateLabel}>
            Manage account access without opening private nutrition data.
          </p>
        </header>

        <SettingsDestinations
          active="users"
          csrfToken={loaderData.csrfToken}
          isAdministrator
        />

        <section
          className={styles.provisioning}
          aria-labelledby="provision-member-heading"
        >
          <header>
            <h2 id="provision-member-heading">Create member</h2>
            <p>
              Set an initial password. Share it outside this application; the
              member must replace it before continuing.
            </p>
          </header>
          <Form
            className={styles.provisioningForm}
            key={actionData?.created ? `created-${actionData.created}` : "ready"}
            method="post"
            noValidate
          >
            <input
              name="csrfToken"
              type="hidden"
              value={loaderData.csrfToken}
            />
            <label>
              <span>Username</span>
              <input
                aria-describedby="member-username-help"
                autoComplete="off"
                defaultValue={actionData?.username}
                maxLength={30}
                name="username"
                pattern="[A-Za-z0-9._-]+"
                required
              />
              <small id="member-username-help">
                3–30 letters, digits, dot, hyphen, or underscore.
              </small>
            </label>
            <label>
              <span>Initial password</span>
              <input
                aria-describedby="member-password-help"
                autoComplete="new-password"
                name="password"
                required
                type="password"
              />
              <small id="member-password-help">
                12–128 characters; never stored or shown after creation.
              </small>
            </label>
            <label>
              <span>Confirm initial password</span>
              <input
                autoComplete="new-password"
                name="confirmPassword"
                required
                type="password"
              />
            </label>
            {actionData?.error ? (
              <p className={styles.error} role="alert">
                {actionData.error}
              </p>
            ) : null}
            {actionData?.created ? (
              <p className={styles.success} role="status">
                <strong>{actionData.created}</strong> was created. Deliver the
                initial password outside this application.
              </p>
            ) : null}
            <button type="submit">Create member</button>
          </Form>
        </section>

        <section className={styles.directory} aria-labelledby="members-heading">
          <div className={styles.directoryHeading}>
            <div>
              <h2 id="members-heading">Members</h2>
              <p>Normalized account names in alphabetical order.</p>
            </div>
            <strong>{loaderData.members.length}</strong>
          </div>
          {loaderData.members.length === 0 ? (
            <p className={styles.empty}>No member accounts yet.</p>
          ) : (
            <ul className={styles.memberList}>
              {loaderData.members.map((member) => (
                <li key={member.username}>
                  <span>
                    <strong>{member.username}</strong>
                    <small>
                      Created {formatLocalDate(member.createdAt.slice(0, 10), {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </small>
                  </span>
                  <span className={styles.memberStates}>
                    {member.passwordChangeRequired ? (
                      <span className={styles.onboardingState}>
                        Password change required
                      </span>
                    ) : null}
                    <span
                      className={
                        member.accessState === "active"
                          ? styles.activeState
                          : styles.disabledState
                      }
                    >
                      {member.accessState === "active" ? "Active" : "Disabled"}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
      <aside
        className={shellStyles.desktopContext}
        aria-label="Member directory privacy"
      >
        <div className={shellStyles.contextCard}>
          <span>Visible here</span>
          <strong>Account metadata</strong>
          <span>Kept private</span>
          <strong>Nutrition data</strong>
          <small>The administrator account is not listed.</small>
        </div>
      </aside>
    </div>
  );
}
