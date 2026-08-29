import { data, Form, redirect } from "react-router";

import type { Route } from "./+types/register";
import styles from "../auth.module.css";
import { AuthShell } from "../auth/auth-shell";
import {
  authenticatedSessionHeaders,
  getClientIp,
  getAuthenticatedSession,
  loadPreAuthenticationCsrf,
  requirePreAuthenticationCsrf,
  requireValidOrigin,
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
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
    password: String(formData.get("password") ?? ""),
    username: String(formData.get("username") ?? ""),
  };
  requirePreAuthenticationCsrf(
    request,
    String(formData.get("csrfToken") ?? ""),
  );
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
    headers: authenticatedSessionHeaders(request, result.session),
  });
}

export default function Register({
  actionData,
  loaderData,
}: Route.ComponentProps) {
  return (
    <AuthShell activePage="register">
      <Form className={styles.form} method="post" noValidate>
        <input
          name="csrfToken"
          type="hidden"
          value={loaderData.csrfToken}
        />
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
            12–128 characters; spaces, Unicode, paste, and password managers are
            supported.
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
    </AuthShell>
  );
}
