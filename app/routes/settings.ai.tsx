import { useEffect } from "react";
import { data, Form, useNavigation, useRevalidator } from "react-router";
import type { Route } from "./+types/settings.ai";
import { AppNavigation } from "../app-navigation";
import { requireAdministratorSession, requireValidOrigin } from "../auth/http.server";
import { getAuthenticationService } from "../auth/runtime.server";
import { getPiConnectionService } from "../photo-analysis/runtime.server";
import { PiConnectionConflict } from "../photo-analysis/pi-connection.server";
import { SettingsDestinations } from "../settings-destinations";
import shellStyles from "../food-log.module.css";
import styles from "../photo-analysis/connection.module.css";

export function meta() {
  return [{ title: "AI photo estimates · Open Calory Tracker" }];
}
export function headers() {
  return { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
}
export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireAdministratorSession(request);
  return {
    csrfToken: session.csrfToken,
    username: session.user.username,
    today: new Date().toISOString().slice(0, 10),
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
  const service = getPiConnectionService();
  try {
    switch (form.get("intent")) {
      case "connect": service.start(session.token); break;
      case "cancel": await service.cancel(session.token, String(form.get("attemptId") ?? "")); break;
      case "disconnect": await service.disconnect(session.token); break;
      default: return data({ error: "Unsupported action." }, { status: 400 });
    }
    return data({ error: undefined });
  } catch (error) {
    if (error instanceof PiConnectionConflict) return data({ error: error.message }, { status: 409 });
    throw error;
  }
}

export default function AiSettings({ loaderData, actionData }: Route.ComponentProps) {
  const { connection } = loaderData;
  const { attempt } = connection;
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const pending = navigation.state !== "idle";
  useEffect(() => {
    if (!connection.busy) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") void revalidator.revalidate();
    }, 2000);
    return () => clearInterval(timer);
  }, [connection.busy, revalidator]);
  const error = actionData?.error ?? attempt?.error ?? connection.error;
  return (
    <div className={shellStyles.shell}>
      <a className={shellStyles.skipLink} href="#ai-settings">Skip to AI settings</a>
      <AppNavigation active="settings" csrfToken={loaderData.csrfToken} selectedDate={loaderData.today} today={loaderData.today} username={loaderData.username} />
      <main className={shellStyles.appSurface} id="ai-settings">
        <header className={shellStyles.mobileHeader}>
          <div className={shellStyles.titleLine}><h1>AI photo estimates</h1></div>
          <p className={shellStyles.selectedDateLabel}>Connect your account once, then add food with a photo.</p>
        </header>
        <section className={styles.card} aria-labelledby="connection-heading">
          <div className={styles.heading}>
            <div><h2 id="connection-heading">OpenAI connection</h2><p>Powered by Pi</p></div>
            <span className={connection.connected ? styles.connected : styles.disconnected}>
              {connection.connected ? "Connected" : "Not connected"}
            </span>
          </div>
          <p>This connection is used for AI photo estimates for everyone on this tracker. Only the administrator can manage it.</p>
          {error ? <p role="alert" className={styles.error}>{error}</p> : null}
          <div role="status" aria-live="polite">
            {connection.busy && !attempt ? <p>A sign-in is in progress in another session.</p> : null}
            {attempt?.state === "starting" ? <p>Getting your sign-in code…</p> : null}
            {attempt?.state === "disconnecting" ? <p>Disconnecting…</p> : null}
            {attempt?.state === "waiting" ? (
              <div className={styles.instructions}>
                <p>Enter this code on OpenAI to connect your account:</p>
                <strong className={styles.code} aria-label="Sign-in code">{attempt.userCode}</strong>
                <a className={styles.primary} href={attempt.verificationUri} target="_blank" rel="noreferrer">Continue to OpenAI ↗</a>
                <p>Return here after approving. This page updates automatically. The code is valid for up to 15 minutes.</p>
                <small>If OpenAI asks, enable device code login in your ChatGPT security settings.</small>
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
          <p className={styles.note}>Your connection is saved automatically and kept across application updates. Disconnecting stops future use of this saved connection; it does not delete meals or revoke access in your OpenAI account.</p>
        </section>
        <SettingsDestinations active="ai" csrfToken={loaderData.csrfToken} isAdministrator />
      </main>
    </div>
  );
}
