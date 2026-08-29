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
  error: string;
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
  const session = await getAuthenticatedSession(request);
  if (!session) return redirect("/login");

  return {
    changed: new URL(request.url).searchParams.get("changed") === "1",
    csrfToken: session.csrfToken,
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
  const csrfToken = String(formData.get("csrfToken") ?? "");
  if (!getAuthenticationService().verifyCsrfToken(session.token, csrfToken)) {
    throw new Response("CSRF token rejected.", { status: 403 });
  }

  const parsed = passwordChangeSchema.safeParse({
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
    currentPassword: String(formData.get("currentPassword") ?? ""),
    newPassword: String(formData.get("newPassword") ?? ""),
  });
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    let error = "Check the password details and try again.";
    if (issue?.path[0] === "currentPassword") {
      error = "Enter your current password.";
    } else if (issue?.path[0] === "newPassword") {
      error = "New password must contain 12–128 characters.";
    } else if (issue?.path[0] === "confirmPassword") {
      error = "New passwords do not match.";
    }
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
    return data<PasswordChangeActionData>(
      { error: "The current password is incorrect." },
      { status: 400 },
    );
  }

  return redirect("/account/password?changed=1", {
    headers: { "Set-Cookie": serializeSessionCookie(result.session) },
  });
}

export default function ChangePassword({
  actionData,
  loaderData,
}: Route.ComponentProps) {
  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="password-heading">
        <Link className={styles.backLink} to="/">
          ← Back to account
        </Link>
        <header className={styles.header}>
          <h1 className={styles.heading} id="password-heading">
            Account security
          </h1>
          <p className={styles.summary}>
            Changing the password revokes other sessions and rotates this one.
          </p>
        </header>

        <Form
          className={styles.form}
          key={loaderData.changed ? "changed" : "ready"}
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
          <div className={styles.field}>
            <label htmlFor="confirm-password">Confirm new password</label>
            <input
              autoComplete="new-password"
              id="confirm-password"
              name="confirmPassword"
              required
              type="password"
            />
          </div>

          {actionData?.error ? (
            <p className={styles.error} role="alert">
              {actionData.error}
            </p>
          ) : null}
          {loaderData.changed ? (
            <p className={styles.success} role="status">
              <strong>Password changed.</strong> Other sessions were revoked.
            </p>
          ) : null}

          <button className={styles.submit} type="submit">
            Change password
          </button>
        </Form>
      </section>
    </main>
  );
}
