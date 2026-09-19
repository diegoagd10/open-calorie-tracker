import { useEffect, useRef } from "react";
import { data, Form, useNavigation, useRevalidator } from "react-router";
import type { Route } from "./+types/settings.ai";
import { AppNavigation } from "../app-navigation";
import { requireAdministratorSession, requireValidOrigin } from "../auth/http.server";
import { getAuthenticationService } from "../auth/runtime.server";
import {
  PhotoAnalysisCredentialInputError,
  PhotoAnalysisCredentialValidationError,
  type PhotoAnalysisCredentialPair,
} from "../photo-analysis/credentials.server";
import { PiConnectionConflict } from "../photo-analysis/pi-connection.server";
import { getPhotoAnalysisCredentials, getPiConnectionService } from "../photo-analysis/runtime.server";
import { SettingsDestinations } from "../settings-destinations";
import shellStyles from "../food-log.module.css";
import styles from "../photo-analysis/connection.module.css";

export function meta() {
  return [{ title: "AI photo estimates · Open Calorie Tracker" }];
}
export function headers() {
  return { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
}
type AiSettingsActionData = {
  area?: "credentials" | "pi";
  error?: string;
  success?: string;
  fieldErrors?: Partial<Record<keyof PhotoAnalysisCredentialPair, string>>;
};
export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireAdministratorSession(request);
  return {
    csrfToken: session.csrfToken,
    username: session.user.username,
    today: new Date().toISOString().slice(0, 10),
    credentials: await (await getPhotoAnalysisCredentials()).status(),
    connection: await getPiConnectionService().read(session.token),
  };
}
export async function action({ request }: Route.ActionArgs) {
  requireValidOrigin(request);
  const session = await requireAdministratorSession(request);
  const form = await request.formData();
  if (!getAuthenticationService().verifyCsrfToken(session.token, String(form.get("csrfToken") ?? ""))) {
    throw new Response("CSRF token rejected.", { status: 403 });
  }
  const credentials = await getPhotoAnalysisCredentials();
  switch (form.get("intent")) {
    case "save":
      try {
        await credentials.replace({
          geminiKey: String(form.get("geminiKey") ?? ""),
          typeSafeKey: String(form.get("typeSafeKey") ?? ""),
        });
        return data<AiSettingsActionData>({ area: "credentials", success: "Photo Analysis credentials saved." });
      } catch (error) {
        if (error instanceof PhotoAnalysisCredentialInputError) {
          return data<AiSettingsActionData>({ area: "credentials", error: error.message, fieldErrors: error.fieldErrors }, { status: 400 });
        }
        if (error instanceof PhotoAnalysisCredentialValidationError) {
          return data<AiSettingsActionData>({ area: "credentials", error: error.message, fieldErrors: error.fieldErrors }, { status: 422 });
        }
        return data<AiSettingsActionData>({ area: "credentials", error: "Credentials could not be saved. The previous pair remains active." }, { status: 503 });
      }
    case "delete":
      if (form.get("confirmation") !== "delete") {
        return data<AiSettingsActionData>({ area: "credentials", error: "Confirm deletion before removing the shared credentials." }, { status: 400 });
      }
      try {
        await credentials.remove();
        return data<AiSettingsActionData>({ area: "credentials", success: "Photo Analysis credentials deleted." });
      } catch {
        return data<AiSettingsActionData>({ area: "credentials", error: "Credentials could not be deleted. The previous pair remains active." }, { status: 503 });
      }
    case "connect":
    case "cancel":
    case "disconnect": {
      const service = getPiConnectionService();
      try {
        if (form.get("intent") === "connect") service.start(session.token);
        if (form.get("intent") === "cancel") await service.cancel(session.token, String(form.get("attemptId") ?? ""));
        if (form.get("intent") === "disconnect") await service.disconnect(session.token);
        return data<AiSettingsActionData>({ area: "pi" });
      } catch (error) {
        if (error instanceof PiConnectionConflict) {
          return data<AiSettingsActionData>({ area: "pi", error: error.message }, { status: 409 });
        }
        throw error;
      }
    }
    default:
      return data<AiSettingsActionData>({ error: "Unsupported action." }, { status: 400 });
  }
}

function statusLabel(state: "configured" | "unconfigured" | "unreadable") {
  if (state === "configured") return "Configured";
  if (state === "unreadable") return "Needs re-entry";
  return "Not configured";
}

export default function AiSettings({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const pending = navigation.state !== "idle";
  const fieldErrors = actionData?.area === "credentials" ? actionData.fieldErrors : undefined;
  const configuredStatus = loaderData.credentials.state === "configured" ? loaderData.credentials : undefined;
  const configured = configuredStatus !== undefined;
  const credentialForm = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (actionData?.area === "credentials") credentialForm.current?.reset();
  }, [actionData]);
  const { connection } = loaderData;
  const { attempt } = connection;
  useEffect(() => {
    if (!connection.busy) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") void revalidator.revalidate();
    }, 2000);
    return () => clearInterval(timer);
  }, [connection.busy, revalidator]);
  const credentialError = actionData?.area === "credentials" ? actionData.error : undefined;
  const credentialSuccess = actionData?.area === "credentials" ? actionData.success : undefined;
  const connectionError = (actionData?.area === "pi" ? actionData.error : undefined) ?? attempt?.error ?? connection.error;
  return (
    <div className={shellStyles.shell}>
      <a className={shellStyles.skipLink} href="#ai-settings">Skip to AI settings</a>
      <AppNavigation active="settings" csrfToken={loaderData.csrfToken} selectedDate={loaderData.today} today={loaderData.today} />
      <main className={shellStyles.appSurface} id="ai-settings">
        <header className={shellStyles.mobileHeader}>
          <div className={shellStyles.titleLine}><h1>AI photo estimates</h1></div>
          <p className={shellStyles.selectedDateLabel}>Manage the shared credentials used for Photo Analysis.</p>
        </header>
        <section className={styles.card} aria-labelledby="credentials-heading">
          <div className={styles.heading}>
            <div><h2 id="credentials-heading">Photo Analysis credentials</h2><p>Gemini and TypeSafe</p></div>
            <span className={configured ? styles.connected : styles.disconnected}>
              {statusLabel(loaderData.credentials.state)}
            </span>
          </div>
          <p>Shared by everyone on this tracker. Saved keys are encrypted and are never shown again.</p>
          {loaderData.credentials.state === "unreadable" ? (
            <p role="alert" className={styles.error}>The saved credential pair cannot be read. Enter and validate both keys again.</p>
          ) : null}
          {credentialError ? <p role="alert" className={styles.error}>{credentialError}</p> : null}
          {credentialSuccess ? <p role="status" className={styles.success}>{credentialSuccess}</p> : null}
          {configuredStatus ? <p className={styles.note}>Last validated {new Date(configuredStatus.validatedAt).toLocaleString()}.</p> : null}
          <Form method="post" className={styles.credentialForm} ref={credentialForm}>
            <input type="hidden" name="csrfToken" value={loaderData.csrfToken} />
            <label htmlFor="gemini-key">Gemini API key</label>
            <input
              id="gemini-key"
              name="geminiKey"
              type="password"
              autoComplete="new-password"
              minLength={16}
              maxLength={512}
              required
              aria-invalid={fieldErrors?.geminiKey ? true : undefined}
              aria-describedby={fieldErrors?.geminiKey ? "gemini-key-error" : undefined}
            />
            {fieldErrors?.geminiKey ? <small id="gemini-key-error" className={styles.fieldError}>{fieldErrors.geminiKey}</small> : null}
            <label htmlFor="typesafe-key">TypeSafe API key</label>
            <input
              id="typesafe-key"
              name="typeSafeKey"
              type="password"
              autoComplete="new-password"
              minLength={16}
              maxLength={512}
              required
              aria-invalid={fieldErrors?.typeSafeKey ? true : undefined}
              aria-describedby={fieldErrors?.typeSafeKey ? "typesafe-key-error" : undefined}
            />
            {fieldErrors?.typeSafeKey ? <small id="typesafe-key-error" className={styles.fieldError}>{fieldErrors.typeSafeKey}</small> : null}
            <button className={styles.primary} disabled={pending} name="intent" value="save">
              {pending ? "Validating…" : configured ? "Replace credential pair" : "Save credential pair"}
            </button>
          </Form>
          {loaderData.credentials.state !== "unconfigured" ? (
            <Form method="post" className={styles.deleteForm}>
              <input type="hidden" name="csrfToken" value={loaderData.csrfToken} />
              <label className={styles.confirmation}>
                <input type="checkbox" name="confirmation" value="delete" required />
                I understand this disables new Photo Analysis credential consumers.
              </label>
              <button disabled={pending} name="intent" value="delete">Delete credential pair</button>
            </Form>
          ) : null}
          <p className={styles.note}>Replacing or deleting this pair does not change users, meals, saved Food Entries, Photo Analysis history, or the active Pi analyzer.</p>
        </section>
        <section className={styles.card} aria-labelledby="connection-heading">
          <div className={styles.heading}>
            <div><h2 id="connection-heading">OpenAI connection</h2><p>Active Pi analyzer</p></div>
            <span className={connection.connected ? styles.connected : styles.disconnected}>
              {connection.connected ? "Connected" : "Not connected"}
            </span>
          </div>
          <p>Pi remains the active analyzer until the provider cutover. This connection is shared by everyone on this tracker.</p>
          {connectionError ? <p role="alert" className={styles.error}>{connectionError}</p> : null}
          <div role="status" aria-live="polite">
            {connection.busy && !attempt ? <p>A sign-in is in progress in another session.</p> : null}
            {attempt?.state === "starting" ? <p>Getting your secure OpenAI link…</p> : null}
            {attempt?.state === "disconnecting" ? <p>Disconnecting…</p> : null}
            {attempt?.state === "waiting" ? (
              <div className={styles.instructions}>
                <p>Open this secure link and approve access with your OpenAI account:</p>
                <a className={styles.primary} href={attempt.authorizationUrl} target="_blank" rel="noreferrer">Authorize with OpenAI ↗</a>
                <p>Return here after approving; Pi receives the browser callback and saves the connection automatically.</p>
                <small>The link is valid for up to 15 minutes. No device-code login setting is required.</small>
              </div>
            ) : null}
            {attempt?.state === "cancelled" ? <p>{connection.connected ? "Sign-in cancelled. Your previous connection is still saved." : "No active sign-in. You can connect whenever you’re ready."}</p> : null}
          </div>
          <Form method="post" className={styles.actions}>
            <input type="hidden" name="csrfToken" value={loaderData.csrfToken} />
            <input type="hidden" name="attemptId" value={attempt?.id ?? ""} />
            {connection.busy ? (
              attempt && attempt.state !== "disconnecting" ? <button disabled={pending} name="intent" value="cancel">Cancel sign-in</button> : null
            ) : (
              <>
                {connection.supported ? <button className={styles.primary} disabled={pending} name="intent" value="connect">{pending ? "Please wait…" : connection.connected ? "Reconnect OpenAI" : "Connect OpenAI"}</button> : <p>The configured AI provider does not support sign-in here.</p>}
                {connection.connected ? <button disabled={pending} name="intent" value="disconnect">Disconnect</button> : null}
              </>
            )}
          </Form>
          <p className={styles.note}>Pi credentials stay in their existing auth file and are not copied into the encrypted bundle.</p>
        </section>
        <SettingsDestinations active="ai" csrfToken={loaderData.csrfToken} isAdministrator />
      </main>
    </div>
  );
}
