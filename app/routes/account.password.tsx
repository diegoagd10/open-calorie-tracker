import { useState } from "react";
import { data, Form, Link, redirect, useRevalidator } from "react-router";

import type { Route } from "./+types/account.password";
import styles from "../account.module.css";
import {
  getSessionForAccountAccess,
  requireValidOrigin,
  serializeClearedSessionCookie,
  serializeSessionCookie,
} from "../auth/http.server";
import { getAuthenticationService } from "../auth/runtime.server";
import { passwordChangeSchema } from "../auth/validation";
import { replaceFallbackPassword, cancelKeyPrompt, keyProviderError } from "../auth/key-ceremony.client";
import { applicationOrigin, effectiveRequestPolicy } from "../runtime.server";

type PasswordChangeActionData = {
  changed?: true;
  error?: string;
};

export function meta() {
  return [
    { title: "Change password · Open Calorie Tracker" },
    { name: "description", content: "Change your private account password" },
  ];
}

export function headers() {
  return { "Cache-Control": "no-store" };
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await getSessionForAccountAccess(request);
  if (!session) return redirect("/login");
  const keyLoginEnabled = getAuthenticationService().keys.status(session.token).enabled;
  if (keyLoginEnabled && effectiveRequestPolicy().entry === "lan")
    return redirect(`${applicationOrigin()}/account/password`);

  return {
    csrfToken: session.csrfToken,
    passwordChangeRequired: session.user.passwordChangeRequired,
    username: session.user.username,
    keyLoginEnabled,
  };
}

export async function action({ request }: Route.ActionArgs) {
  requireValidOrigin(request);
  const session = await getSessionForAccountAccess(request);
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
  if (!await getAuthenticationService().authenticate(session.token))
    return redirect("/login", { headers: { "Set-Cookie": serializeClearedSessionCookie() } });
  if (getAuthenticationService().keys.status(session.token).enabled)
    return data<PasswordChangeActionData>({ error: "Verify a registered key to replace your fallback password." }, { status: 400 });

  const parsed = passwordChangeSchema.safeParse({
    confirmNewPassword: String(formData.get("confirmNewPassword") ?? ""),
    currentPassword: String(formData.get("currentPassword") ?? ""),
    newPassword: String(formData.get("newPassword") ?? ""),
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0].path[0];
    const error =
      field === "currentPassword"
        ? "Enter your current password."
        : field === "newPassword"
          ? "New password must contain 12–128 characters."
          : "New passwords do not match.";
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
    if (result.error === "key-proof-required")
      return data<PasswordChangeActionData>({ error: "Verify a registered key to replace your fallback password." }, { status: 400 });
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
  const [busy, setBusy] = useState(false);
  const [keyError, setKeyError] = useState("");
  const [changed, setChanged] = useState(false);
  const revalidator = useRevalidator();
  const formStateKey = actionData?.changed || changed ? "changed" : "ready";
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
              ? "Replace the temporary password before continuing."
              : "Changing the password revokes other sessions and rotates this one."}
          </p>
          <p>
            {loaderData.keyLoginEnabled
              ? "Verify a registered key to replace your fallback password. You do not need the old password. Key login and all saved keys stay enabled; this password is used only after key login is deliberately disabled or recovered."
              : "Enter your current password to authorize this change."}
          </p>
        </header>

        <Form
          className={styles.form}
          key={formStateKey}
          method="post"
          noValidate
          onSubmit={loaderData.keyLoginEnabled ? (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const fields = new FormData(form);
            setBusy(true);
            setChanged(false);
            setKeyError("");
            void replaceFallbackPassword(loaderData.csrfToken, String(fields.get("newPassword") ?? ""), String(fields.get("confirmNewPassword") ?? ""))
              .then(async (result) => {
                if (result.nextPath === "/setup") {
                  window.location.assign(result.nextPath);
                  return;
                }
                form.reset();
                await revalidator.revalidate();
                setChanged(true);
                setBusy(false);
              })
              .catch((failure: unknown) => {
                setKeyError(keyProviderError(failure));
                setBusy(false);
              });
          } : undefined}
        >
          <input name="csrfToken" type="hidden" value={loaderData.csrfToken} />
          <input
            autoComplete="username"
            name="username"
            type="hidden"
            value={loaderData.username}
          />
          {!loaderData.keyLoginEnabled ? <div className={styles.field}>
            <label htmlFor="current-password">Current password</label>
            <input
              autoComplete="current-password"
              autoFocus={loaderData.passwordChangeRequired}
              id="current-password"
              name="currentPassword"
              required
              type="password"
            />
          </div> : null}
          <div className={styles.field}>
            <label htmlFor="new-password">New password</label>
            <input
              aria-describedby="new-password-help"
              autoComplete="new-password"
              id="new-password"
              name="newPassword"
              required
              type="password"
              disabled={busy}
              autoFocus={loaderData.keyLoginEnabled && loaderData.passwordChangeRequired}
            />
            <small id="new-password-help">
              12–128 characters; spaces and Unicode are welcome.
            </small>
          </div>
          <div className={styles.field}>
            <label htmlFor="confirm-new-password">Confirm new password</label>
            <input
              autoComplete="new-password"
              id="confirm-new-password"
              name="confirmNewPassword"
              required
              type="password"
              disabled={busy}
            />
          </div>
          {keyError || actionData?.error ? (
            <p className={styles.error} role="alert">
              {keyError || actionData?.error}
            </p>
          ) : null}
          {actionData?.changed || changed ? (
            <p className={styles.success} role="status">
              <strong>Password changed.</strong> Other sessions were revoked.
            </p>
          ) : null}

          <button className={styles.submit} type="submit" disabled={busy}>
            {loaderData.passwordChangeRequired
              ? "Set password and continue"
              : "Change password"}
          </button>
          {busy ? <>
            <p role="status">Verify a registered key with its PIN or biometrics to replace your fallback password.</p>
            <button className={styles.submit} type="button" onClick={cancelKeyPrompt}>Cancel key prompt</button>
          </> : null}
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
