import { data, Form, Link, redirect } from "react-router";

import type { Route } from "./+types/register";
import styles from "../auth.module.css";
import {
  getClientIp,
  getAuthenticatedSession,
  requireValidOrigin,
  serializeSessionCookie,
} from "../auth/http.server";
import { getAuthenticationService } from "../auth/runtime.server";
import { registrationSchema } from "../auth/validation";

type RegistrationActionData = {
  error?: string;
  username?: string;
};

export function meta() {
  return [
    { title: "Register · Open Calory Tracker" },
    { name: "description", content: "Create a private account" },
  ];
}

export function headers() {
  return { "Cache-Control": "no-store" };
}

export async function loader({ request }: Route.LoaderArgs) {
  if (await getAuthenticatedSession(request)) {
    return redirect("/");
  }

  return null;
}

export async function action({ request }: Route.ActionArgs) {
  requireValidOrigin(request);
  const formData = await request.formData();
  const fields = {
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
    password: String(formData.get("password") ?? ""),
    username: String(formData.get("username") ?? ""),
  };
  const parsed = registrationSchema.safeParse(fields);

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    let error = "Check the highlighted account details and try again.";

    if (issue?.path[0] === "username") {
      error = "Use 3–30 ASCII letters, digits, dot, hyphen, or underscore.";
    } else if (issue?.path[0] === "password") {
      error = "Password must contain 12–128 characters.";
    } else if (issue?.path[0] === "confirmPassword") {
      error = "Passwords do not match.";
    }

    return data<RegistrationActionData>(
      { error, username: fields.username },
      { status: 400 },
    );
  }

  const result = await getAuthenticationService().register(
    parsed.data.username,
    parsed.data.password,
    getClientIp(request),
  );

  if (!result.ok) {
    if (result.error === "rate-limited") {
      return data<RegistrationActionData>(
        {
          error: "Too many registration attempts. Try again later.",
          username: fields.username,
        },
        { status: 429 },
      );
    }

    return data<RegistrationActionData>(
      {
        error:
          "That username is already registered. Usernames are compared case-insensitively.",
        username: fields.username,
      },
      { status: 409 },
    );
  }

  return redirect("/", {
    headers: { "Set-Cookie": serializeSessionCookie(result.session) },
  });
}

export default function Register({ actionData }: Route.ComponentProps) {
  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="auth-title">
        <header className={styles.header}>
          <h1 className={styles.heading} id="auth-title">
            Private account access
          </h1>
          <span className={styles.privacyCue}>No email required</span>
        </header>

        <nav className={styles.tabs} aria-label="Account access">
          <Link className={styles.tab} to="/login">
            Sign in
          </Link>
          <Link
            aria-current="page"
            className={`${styles.tab} ${styles.activeTab}`}
            to="/register"
          >
            Register
          </Link>
        </nav>

        <Form className={styles.form} method="post" noValidate>
          <div className={styles.field}>
            <label htmlFor="register-username">Username</label>
            <input
              aria-describedby="register-username-help"
              autoComplete="username"
              defaultValue={actionData?.username}
              id="register-username"
              maxLength={30}
              name="username"
              pattern="[A-Za-z0-9._-]+"
              required
            />
            <small id="register-username-help">
              3–30 letters, digits, dot, hyphen, or underscore.
            </small>
          </div>

          <div className={styles.field}>
            <label htmlFor="register-password">Password</label>
            <input
              aria-describedby="register-password-help"
              autoComplete="new-password"
              id="register-password"
              name="password"
              required
              type="password"
            />
            <small id="register-password-help">
              12–128 characters; spaces, Unicode, paste, and password managers
              are supported.
            </small>
          </div>

          <div className={styles.field}>
            <label htmlFor="register-confirm-password">Confirm password</label>
            <input
              autoComplete="new-password"
              id="register-confirm-password"
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

          <button className={styles.submit} type="submit">
            Create private account
          </button>
        </Form>
      </section>
    </main>
  );
}
