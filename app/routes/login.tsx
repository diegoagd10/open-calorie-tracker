import { data, Form, redirect } from "react-router";

import type { Route } from "./+types/login";
import styles from "../auth.module.css";
import { AuthShell } from "../auth/auth-shell";
import {
  authenticatedSessionHeaders,
  getClientIp,
  getSessionForAccountAccess,
  loadPreAuthenticationCsrf,
  requirePreAuthenticationCsrf,
  requireValidOrigin,
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
    { title: "Sign in · Open Calorie Tracker" },
    { name: "description", content: "Sign in to your private account" },
  ];
}

export function headers() {
  return { "Cache-Control": "no-store" };
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await getSessionForAccountAccess(request);
  if (session) {
    return redirect(
      session.user.passwordChangeRequired ? "/account/password" : "/",
    );
  }

  if (getAuthenticationService().isRegistrationOpen()) {
    return redirect("/register");
  }

  const csrf = loadPreAuthenticationCsrf(request);
  return data(
    { csrfToken: csrf.csrfToken },
    { headers: csrf.headers },
  );
}

export async function action({ request }: Route.ActionArgs) {
  requireValidOrigin(request);
  const formData = await request.formData();
  const fields = {
    password: String(formData.get("password") ?? ""),
    username: String(formData.get("username") ?? ""),
  };
  requirePreAuthenticationCsrf(
    request,
    String(formData.get("csrfToken") ?? ""),
  );
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
    if (result.error === "account-disabled") {
      return data<LoginActionData>(
        {
          error: "Your account has been disabled.",
          username: fields.username,
        },
        { status: 403 },
      );
    }

    return data<LoginActionData>(
      { error: genericLoginError, username: fields.username },
      { status: 401 },
    );
  }

  return redirect(
    result.session.user.passwordChangeRequired ? "/account/password" : "/",
    {
    headers: authenticatedSessionHeaders(request, result.session),
    },
  );
}

export default function Login({ actionData, loaderData }: Route.ComponentProps) {
  return (
    <AuthShell>
      <Form className={styles.form} method="post" noValidate>
        <input
          name="csrfToken"
          type="hidden"
          value={loaderData.csrfToken}
        />
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
    </AuthShell>
  );
}
