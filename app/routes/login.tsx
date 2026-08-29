import { data, Form, Link, redirect } from "react-router";

import type { Route } from "./+types/login";
import styles from "../auth.module.css";
import {
  getClientIp,
  getAuthenticatedSession,
  requireValidOrigin,
  serializeSessionCookie,
} from "../auth/http.server";
import { getAuthenticationService } from "../auth/runtime.server";
import { loginSchema } from "../auth/validation";

type LoginActionData = {
  error: string;
  username: string;
};

const genericLoginError = "The username or password is incorrect.";

export function meta() {
  return [
    { title: "Sign in · Open Calory Tracker" },
    { name: "description", content: "Sign in to your private account" },
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
    password: String(formData.get("password") ?? ""),
    username: String(formData.get("username") ?? ""),
  };
  const parsed = loginSchema.safeParse(fields);

  if (!parsed.success) {
    return data<LoginActionData>(
      { error: genericLoginError, username: fields.username },
      { status: 400 },
    );
  }

  const result = await getAuthenticationService().login(
    parsed.data.username,
    parsed.data.password,
    getClientIp(request),
  );

  if (!result.ok) {
    if (result.error === "rate-limited") {
      return data<LoginActionData>(
        {
          error: "Too many sign-in attempts. Try again later.",
          username: fields.username,
        },
        { status: 429 },
      );
    }

    return data<LoginActionData>(
      { error: genericLoginError, username: fields.username },
      { status: 401 },
    );
  }

  return redirect("/", {
    headers: { "Set-Cookie": serializeSessionCookie(result.session) },
  });
}

export default function Login({ actionData }: Route.ComponentProps) {
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
          <Link
            aria-current="page"
            className={`${styles.tab} ${styles.activeTab}`}
            to="/login"
          >
            Sign in
          </Link>
          <Link className={styles.tab} to="/register">
            Register
          </Link>
        </nav>

        <Form className={styles.form} method="post" noValidate>
          <div className={styles.field}>
            <label htmlFor="login-username">Username</label>
            <input
              autoComplete="username"
              defaultValue={actionData?.username}
              id="login-username"
              maxLength={30}
              name="username"
              required
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="login-password">Password</label>
            <input
              autoComplete="current-password"
              id="login-password"
              name="password"
              required
              type="password"
            />
          </div>

          {actionData?.error ? (
            <div className={styles.error} role="alert">
              <strong>Couldn’t sign in</strong>
              <br />
              {actionData.error}
            </div>
          ) : null}

          <button className={styles.submit} type="submit">
            Sign in
          </button>
        </Form>
      </section>
    </main>
  );
}
