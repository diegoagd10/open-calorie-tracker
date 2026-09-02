import { data, Form, Link, redirect } from "react-router";

import type { Route } from "./+types/account.password";
import styles from "../account.module.css";
import {
  getAuthenticatedSession,
  requireValidOrigin,
  serializeClearedSessionCookie,
  serializeSessionCookie,
} from "../auth/http.server";
import { getAuthenticationService } from "../auth/runtime.server";
import { passwordChangeSchema } from "../auth/validation";

type PasswordChangeActionData = {
  changed?: true;
  error?: string;
};

export function meta() {
  return [
    { title: "Change password · Open Calory Tracker" },
    { name: "description", content: "Change your private account password" },
  ];
}

export function headers() {
  return { "Cache-Control": "no-store" };
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await getAuthenticatedSession(request, {
    allowPasswordChangeRequired: true,
  });
  if (!session) return redirect("/login");

  return {
    csrfToken: session.csrfToken,
    passwordChangeRequired: session.user.passwordChangeRequired,
    username: session.user.username,
  };
}

export async function action({ request }: Route.ActionArgs) {
  requireValidOrigin(request);
  const session = await getAuthenticatedSession(request, {
    allowPasswordChangeRequired: true,
  });
  if (!session) {
    return redirect("/login", {
      headers: { "Set-Cookie": serializeClearedSessionCookie() },
    });
  }

  const formData = await request.formData();
  // Stryker disable next-line StringLiteral: every placeholder for a missing opaque token is rejected identically.
  const csrfToken = String(formData.get("csrfToken") ?? "");
  if (!getAuthenticationService().verifyCsrfToken(session.token, csrfToken)) {
    throw new Response("CSRF token rejected.", { status: 403 });
  }

  const parsed = passwordChangeSchema.safeParse({
    currentPassword: String(formData.get("currentPassword") ?? ""),
    newPassword: String(formData.get("newPassword") ?? ""),
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0].path[0];
    const error =
      field === "currentPassword"
        ? "Enter your current password."
        : "New password must contain 12–128 characters.";
    return data<PasswordChangeActionData>({ error }, { status: 400 });
  }

  const result = await getAuthenticationService().changePassword(
    session,
    parsed.data.currentPassword,
    parsed.data.newPassword,
  );
  if (!result.ok) {
    if (result.error === "invalid-session") {
      return redirect("/login", {
        headers: { "Set-Cookie": serializeClearedSessionCookie() },
      });
    }
    if (result.error === "rate-limited") {
      return data<PasswordChangeActionData>(
        { error: "Too many password attempts. Try again later." },
        { status: 429 },
      );
    }
    if (result.error === "password-reuse") {
      return data<PasswordChangeActionData>(
        { error: "Choose a password different from the temporary password." },
        { status: 400 },
      );
    }
    return data<PasswordChangeActionData>(
      { error: "The current password is incorrect." },
      { status: 400 },
    );
  }

  if (session.user.passwordChangeRequired) {
    return redirect("/setup", {
      headers: { "Set-Cookie": serializeSessionCookie(result.session) },
    });
  }

  return data<PasswordChangeActionData>(
    { changed: true },
    { headers: { "Set-Cookie": serializeSessionCookie(result.session) } },
  );
}

export default function ChangePassword({
  actionData,
  loaderData,
}: Route.ComponentProps) {
  // Stryker disable next-line StringLiteral: these labels are arbitrary; only their distinction is observable.
  const formStateKey = actionData?.changed ? "changed" : "ready";
  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="password-heading">
        {!loaderData.passwordChangeRequired ? (
          <Link className={styles.backLink} to="/">
            ← Back to account
          </Link>
        ) : null}
        <header className={styles.header}>
          <h1 className={styles.heading} id="password-heading">
            {loaderData.passwordChangeRequired
              ? "Set your private password"
              : "Account security"}
          </h1>
          <p className={styles.summary}>
            {loaderData.passwordChangeRequired
              ? "Replace the temporary password before setting up your Food Log."
              : "Changing the password revokes other sessions and rotates this one."}
          </p>
        </header>

        <Form
          className={styles.form}
          key={formStateKey}
          method="post"
          noValidate
        >
          <input name="csrfToken" type="hidden" value={loaderData.csrfToken} />
          <input
            autoComplete="username"
            name="username"
            type="hidden"
            value={loaderData.username}
          />
          <div className={styles.field}>
            <label htmlFor="current-password">Current password</label>
            <input
              autoComplete="current-password"
              autoFocus={loaderData.passwordChangeRequired}
              id="current-password"
              name="currentPassword"
              required
              type="password"
            />
          </div>
          <div className={styles.field}>
            <label htmlFor="new-password">New password</label>
            <input
              aria-describedby="new-password-help"
              autoComplete="new-password"
              id="new-password"
              name="newPassword"
              required
              type="password"
            />
            <small id="new-password-help">
              12–128 characters; spaces and Unicode are welcome.
            </small>
          </div>
          {actionData?.error ? (
            <p className={styles.error} role="alert">
              {actionData.error}
            </p>
          ) : null}
          {actionData?.changed ? (
            <p className={styles.success} role="status">
              <strong>Password changed.</strong> Other sessions were revoked.
            </p>
          ) : null}

          <button className={styles.submit} type="submit">
            {loaderData.passwordChangeRequired
              ? "Set password and continue"
              : "Change password"}
          </button>
        </Form>
        {loaderData.passwordChangeRequired ? (
          <Form action="/logout" className={styles.signOutForm} method="post">
            <input
              name="csrfToken"
              type="hidden"
              value={loaderData.csrfToken}
            />
            <button type="submit">Sign out</button>
          </Form>
        ) : null}
      </section>
    </main>
  );
}
