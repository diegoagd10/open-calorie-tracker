import { data, Form, redirect } from "react-router";

import type { Route } from "./+types/register";
import styles from "../auth.module.css";
import { AuthShell } from "../auth/auth-shell";
import {
  authenticatedSessionHeaders,
  getClientIp,
  getSessionForApplicationAccess,
  loadPreAuthenticationCsrf,
  requirePreAuthenticationCsrf,
  requireValidOrigin,
} from "../auth/http.server";
import { getAuthenticationService } from "../auth/runtime.server";
import { registrationSchema } from "../auth/validation";
import { logBootstrapRejected } from "../auth/bootstrap-events.server";

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

async function registrationAccess(request: Request) {
  if (await getSessionForApplicationAccess(request)) {
    logBootstrapRejected("authenticated-request");
    throw new Response("Not Found", { status: 404 });
  }

  const authentication = getAuthenticationService();
  if (!authentication.isRegistrationOpen()) {
    logBootstrapRejected("claimed-instance");
    return redirect("/login");
  }

  return authentication;
}

export async function loader({ request }: Route.LoaderArgs) {
  const access = await registrationAccess(request);
  if (access instanceof Response) return access;

  const csrf = loadPreAuthenticationCsrf(request);
  return data(
    { csrfToken: csrf.csrfToken },
    { headers: csrf.headers },
  );
}

export async function action({ request }: Route.ActionArgs) {
  const authentication = await registrationAccess(request);
  if (authentication instanceof Response) return authentication;

  try {
    requireValidOrigin(request);
  } catch (error) {
    logBootstrapRejected("invalid-origin");
    throw error;
  }
  const formData = await request.formData();
  const fields = {
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
    password: String(formData.get("password") ?? ""),
    username: String(formData.get("username") ?? ""),
  };
  try {
    requirePreAuthenticationCsrf(
      request,
      // Stryker disable next-line StringLiteral: every placeholder for a missing opaque token is rejected identically.
      String(formData.get("csrfToken") ?? ""),
    );
  } catch (error) {
    logBootstrapRejected("invalid-csrf");
    throw error;
  }
  const parsed = registrationSchema.safeParse(fields);

  if (!parsed.success) {
    logBootstrapRejected("invalid-input");
    const field = parsed.error.issues[0].path[0];
    const error =
      field === "username"
        ? "Use 3–30 ASCII letters, digits, dot, hyphen, or underscore."
        : field === "password"
          ? "Password must contain 12–128 characters."
          : "Passwords do not match.";

    return data<RegistrationActionData>(
      { error, username: fields.username },
      { status: 400 },
    );
  }

  const result = await authentication.register(
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

    return redirect("/login");
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
    <AuthShell>
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
