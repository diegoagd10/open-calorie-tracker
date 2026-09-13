import { useState } from "react";
import { Link, redirect } from "react-router";
import type { Route } from "./+types/settings.security";
import { requireApplicationSession } from "../auth/http.server";
import { getAuthenticationService } from "../auth/runtime.server";
import { enrollmentPreviewEnabled } from "../runtime.server";
import {
  enrollKey,
  changeKeyLoginMode,
  keyProviderError,
  cancelKeyPrompt,
} from "../auth/key-ceremony.client";
import { getGoalSetupService } from "../setup/runtime.server";
import { applicationOrigin, effectiveRequestPolicy } from "../runtime.server";
import styles from "../account.module.css";

export function meta() {
  return [{ title: "Account security · Open Calorie Tracker" }];
}
export function headers() {
  return { "Cache-Control": "no-store" };
}
export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireApplicationSession(request);
  if (!getGoalSetupService().isComplete(session.user.id))
    return redirect("/setup");
  if (effectiveRequestPolicy().entry === "lan")
    return redirect(`${applicationOrigin()}/settings/security`);
  return {
    csrfToken: session.csrfToken,
    username: session.user.username,
    preview: enrollmentPreviewEnabled(),
    ...getAuthenticationService().keys.status(session.token),
  };
}
export default function SecuritySettings({ loaderData }: Route.ComponentProps) {
  const [busy, setBusy] = useState(false);
  const [modeChange, setModeChange] = useState(false);
  const [error, setError] = useState("");
  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="security-title">
        <Link className={styles.backLink} to="/settings/goals">
          Back to settings
        </Link>
        <h1 id="security-title">Account security</h1>
        <p>Personal sign-in settings for {loaderData.username}.</p>
        <h2>
          {loaderData.enabled
            ? "Key login is enabled"
            : "Password login is enabled"}
        </h2>
        <p>
          A compatible YubiKey or Proton Pass passkey replaces password sign-in
          when key login is enabled. Your account password is retained. Your key
          may ask for its own PIN or biometrics.
        </p>
        {loaderData.credentials.length ? (
          <p>
            {loaderData.enabled
              ? "Saved keys can sign you in. Disabling keeps every key and restores password sign-in."
              : "Your keys are retained, but cannot sign you in while key login is disabled. Verify a retained key to re-enable; no account password is needed."}
          </p>
        ) : null}
        {loaderData.preview && loaderData.credentials.length ? (
          <button
            className={styles.submit}
            type="button"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setModeChange(true);
              setError("");
              void changeKeyLoginMode(loaderData.csrfToken, !loaderData.enabled)
                .then((result) => window.location.assign(result.nextPath))
                .catch((failure: unknown) => {
                  setError(keyProviderError(failure));
                  setBusy(false);
                });
            }}
          >
            {loaderData.enabled ? "Disable key login" : "Re-enable key login"}
          </button>
        ) : null}
        {loaderData.credentials.length ? (
          <ul>
            {loaderData.credentials.map((key) => (
              <li key={key.id}>{key.name}</li>
            ))}
          </ul>
        ) : null}
        {loaderData.preview ? (
          <form
            className={styles.form}
            onSubmit={(event) => {
              event.preventDefault();
              const name = String(
                new FormData(event.currentTarget).get("name") ?? "",
              );
              setBusy(true);
              setModeChange(false);
              setError("");
              void (async () => {
                try {
                  const result = await enrollKey(
                    loaderData.csrfToken,
                    name,
                    loaderData.enabled,
                  );
                  window.location.assign(result.nextPath);
                } catch (failure) {
                  setError(keyProviderError(failure));
                  setBusy(false);
                }
              })();
            }}
          >
            <div className={styles.field}>
              <label htmlFor="key-name">Key name</label>
              <input
                id="key-name"
                name="name"
                maxLength={80}
                required
                placeholder="My YubiKey or Proton Pass"
              />
            </div>
            <p>
              {loaderData.enabled
                ? "First verify an existing key, then register and verify your new key."
                : loaderData.credentials.length
                  ? "Register and verify another key. Password login stays enabled."
                  : "Enrollment creates a key and then verifies it. Password login stays available until both prompts succeed. Enabling signs out your other sessions."}
            </p>
            <button className={styles.submit} disabled={busy} type="submit">
              {busy
                ? "Follow your key prompts…"
                : loaderData.credentials.length
                  ? "Add another key"
                  : "Enroll and enable key login"}
            </button>
            {busy ? (
              <button
                className={styles.submit}
                type="button"
                onClick={cancelKeyPrompt}
              >
                Cancel key prompt
              </button>
            ) : null}
          </form>
        ) : null}
        {error ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        <p role="status">
          {busy
            ? modeChange
              ? "Verify any saved key to change sign-in mode. This signs out older sessions."
              : loaderData.enabled
              ? "Verify an existing key, then register and verify the new key."
              : "Complete registration, then verify the new key."
            : ""}
        </p>
        <Link to="/account/password">Change account password</Link>
      </section>
    </main>
  );
}
