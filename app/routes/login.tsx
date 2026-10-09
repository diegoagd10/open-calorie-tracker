import { useState, type FormEvent } from "react";
import { beginSignIn } from "../auth/key-ceremony.client";
import { applicationOrigin, effectiveRequestPolicy } from "../runtime.server";
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
import { loginSchema, usernameSchema } from "../auth/validation";

type LoginActionData = {
  error: string;
  username: string;
};
type LoginStep = "username" | "password";

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
    {
      csrfToken: csrf.csrfToken,
      publicKeyUrl:
        effectiveRequestPolicy().entry === "lan"
          ? `${applicationOrigin()}/login`
          : null,
    },
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
  // The username step submits without a password field before hydration;
  // answer it with the password step rather than a failure.
  if (!formData.has("password"))
    return data<LoginActionData>(
      { error: "", username: fields.username },
      { status: 200 },
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
    result.session.user.passwordChangeRequired
      ? "/account/password"
      : "/",
    {
      headers: authenticatedSessionHeaders(request, result.session),
    },
  );
}

export default function Login({
  actionData,
  loaderData,
}: Route.ComponentProps) {
  const [step, setStep] = useState<LoginStep>(
    actionData ? "password" : "username",
  );
  const [username, setUsername] = useState(actionData?.username ?? "");
  // Leaving the password step retires the failure it showed.
  const [retiredFailure, setRetiredFailure] = useState<LoginActionData>();
  return (
    <AuthShell>
      {loaderData.publicKeyUrl ? (
        <LanLoginForm
          actionData={actionData}
          csrfToken={loaderData.csrfToken}
          publicKeyUrl={loaderData.publicKeyUrl}
        />
      ) : step === "username" ? (
        <UsernameStep
          csrfToken={loaderData.csrfToken}
          defaultUsername={username}
          onPassword={(next) => {
            setUsername(next);
            setStep("password");
          }}
        />
      ) : (
        <PasswordStep
          csrfToken={loaderData.csrfToken}
          error={actionData === retiredFailure ? undefined : actionData?.error}
          onBack={() => {
            setRetiredFailure(actionData);
            setStep("username");
          }}
          username={username}
        />
      )}
    </AuthShell>
  );
}

function UsernameStep({
  csrfToken,
  defaultUsername,
  onPassword,
}: {
  csrfToken: string;
  defaultUsername: string;
  onPassword: (username: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      className={styles.form}
      method="post"
      noValidate
      onSubmit={(event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const username = String(
          new FormData(event.currentTarget).get("username") ?? "",
        );
        // A malformed username can never own a key; the password action
        // answers it with the same generic failure as any other account.
        if (!usernameSchema.safeParse(username).success) {
          onPassword(username);
          return;
        }
        setBusy(true);
        setCancelled(false);
        setError("");
        void (async () => {
          try {
            const outcome = await beginSignIn(csrfToken, username);
            if (outcome.kind === "signed-in")
              return window.location.assign(outcome.nextPath);
            if (outcome.kind === "password") return onPassword(username);
            setCancelled(true);
          } catch (failure) {
            setError(
              failure instanceof Error
                ? failure.message
                : "Key request failed. Retry.",
            );
          }
          setBusy(false);
        })();
      }}
    >
      <input name="csrfToken" type="hidden" value={csrfToken} />
      <div className={styles.field}>
        <label htmlFor="login-username">Username</label>
        <input
          autoComplete="username"
          defaultValue={defaultUsername}
          id="login-username"
          maxLength={30}
          name="username"
          required
        />
      </div>
      {cancelled || error ? (
        <p className={styles.error} role="alert">
          {cancelled ? "The passkey prompt was cancelled." : error}
        </p>
      ) : null}
      <button className={styles.submit} disabled={busy} type="submit">
        Next
      </button>
    </form>
  );
}

function PasswordStep({
  csrfToken,
  error,
  onBack,
  username,
}: {
  csrfToken: string;
  error?: string;
  onBack: () => void;
  username: string;
}) {
  return (
    <Form className={styles.form} method="post" noValidate>
      <input name="csrfToken" type="hidden" value={csrfToken} />
      <input
        autoComplete="username"
        name="username"
        type="hidden"
        value={username}
      />
      <div className={styles.field}>
        <label htmlFor="login-password">Password</label>
        <input
          autoComplete="current-password"
          autoFocus
          id="login-password"
          name="password"
          required
          type="password"
        />
      </div>
      <LoginError error={error} />
      <button className={styles.submit} type="submit">
        Sign in
      </button>
      <button className={styles.secondary} onClick={onBack} type="button">
        Back
      </button>
    </Form>
  );
}

function LanLoginForm({
  actionData,
  csrfToken,
  publicKeyUrl,
}: {
  actionData?: LoginActionData;
  csrfToken: string;
  publicKeyUrl: string;
}) {
  return (
    <Form className={styles.form} method="post" noValidate>
      <input name="csrfToken" type="hidden" value={csrfToken} />
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
      <LoginError error={actionData?.error} />
      <a href={publicKeyUrl}>Use key sign-in on public HTTPS</a>
      <button className={styles.submit} type="submit">
        Sign in
      </button>
    </Form>
  );
}

function LoginError({ error }: { error?: string }) {
  return error ? (
    <div className={styles.error} role="alert">
      <strong>Couldn’t sign in</strong>
      <br />
      {error}
    </div>
  ) : null;
}
