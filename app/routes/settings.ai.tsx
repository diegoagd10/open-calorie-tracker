import { useEffect } from "react";
import { data, Form, useNavigation, useRevalidator, useSearchParams } from "react-router";
import type { Route } from "./+types/settings.ai";
import { AppNavigation } from "../app-navigation";
import { readApplicationMutationForm, requireAdministratorSession, requireValidOrigin } from "../auth/http.server";
import { getPiConnectionService, getProviderPipelineDemo } from "../photo-analysis/runtime.server";
import { PiConnectionConflict } from "../photo-analysis/pi-connection.server";
import { ProviderPipelineDemoView } from "../photo-analysis/provider-pipeline-demo";
import { isProductionEnvironment } from "../runtime.server";
import { SettingsDestinations } from "../settings-destinations";
import shellStyles from "../food-log.module.css";
import styles from "../photo-analysis/connection.module.css";

type AiSettingsActionData = {
  demo?: import("../photo-analysis/provider-pipeline-demo.server").ProviderComparisonResult;
  error?: string;
  message?: string;
};

export function meta() {
  return [{ title: "AI photo estimates · Open Calorie Tracker" }];
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
    providerPrototypeEnabled: !isProductionEnvironment(),
    providerDemo: await getProviderPipelineDemo().status(),
    connection: await getPiConnectionService().read(session.token),
  };
}
export async function action({ request }: Route.ActionArgs) {
  requireValidOrigin(request);
  const session = await requireAdministratorSession(request);
  const form = await readApplicationMutationForm(request, session);
  const intent = String(form.get("intent") ?? "");
  const service = getPiConnectionService();
  try {
    switch (intent) {
      case "save-provider-keys": {
        if (isProductionEnvironment()) return data<AiSettingsActionData>({ error: "Provider demo is unavailable." }, { status: 404 });
        await getProviderPipelineDemo().save({
          geminiApiKey: String(form.get("geminiApiKey") ?? ""),
          jevApiKey: String(form.get("jevApiKey") ?? ""),
        });
        return data<AiSettingsActionData>({ message: "Provider keys saved. You can now test a meal photo." });
      }
      case "remove-provider-keys": {
        if (isProductionEnvironment()) return data<AiSettingsActionData>({ error: "Provider demo is unavailable." }, { status: 404 });
        await getProviderPipelineDemo().remove();
        return data<AiSettingsActionData>({ message: "Provider keys removed from this server." });
      }
      case "run-provider-demo": {
        if (isProductionEnvironment()) return data<AiSettingsActionData>({ error: "Provider demo is unavailable." }, { status: 404 });
        const photo = form.get("photo");
        if (!(photo instanceof File)) throw new Error("Choose a meal photo.");
        const demo = await getProviderPipelineDemo().compare({
          bytes: Buffer.from(await photo.arrayBuffer()),
          mimeType: photo.type,
        });
        return data<AiSettingsActionData>({ demo });
      }
      case "connect": service.start(session.token); break;
      case "cancel": await service.cancel(session.token, String(form.get("attemptId") ?? "")); break;
      case "disconnect": await service.disconnect(session.token); break;
      default: return data<AiSettingsActionData>({ error: "Unsupported action." }, { status: 400 });
    }
    return data<AiSettingsActionData>({});
  } catch (error) {
    if (error instanceof PiConnectionConflict) return data<AiSettingsActionData>({ error: error.message }, { status: 409 });
    if (["save-provider-keys", "remove-provider-keys", "run-provider-demo"].includes(intent)) {
      return data<AiSettingsActionData>({ error: error instanceof Error ? error.message : "Provider demo failed." }, { status: 400 });
    }
    throw error;
  }
}

export default function AiSettings({ loaderData, actionData }: Route.ComponentProps) {
  const { connection } = loaderData;
  const { attempt } = connection;
  const navigation = useNavigation();
  const revalidator = useRevalidator();
  const [searchParams] = useSearchParams();
  const pending = navigation.state !== "idle";
  useEffect(() => {
    if (!connection.busy) return;
    const timer = setInterval(() => {
      if (revalidator.state === "idle") void revalidator.revalidate();
    }, 2000);
    return () => clearInterval(timer);
  }, [connection.busy, revalidator]);
  const error = actionData?.error ?? attempt?.error ?? connection.error;
  const prototype = searchParams.get("prototype");
  if (loaderData.providerPrototypeEnabled && prototype === "providers") {
    return (
      <div className={`${shellStyles.shell} ${styles.prototypeShell}`}>
        <AppNavigation active="settings" csrfToken={loaderData.csrfToken} selectedDate={loaderData.today} today={loaderData.today} />
        <main className={shellStyles.appSurface}>
          <ProviderPipelineDemoView actionData={actionData} csrfToken={loaderData.csrfToken} piConnected={connection.connected} status={loaderData.providerDemo} />
        </main>
      </div>
    );
  }
  return (
    <div className={shellStyles.shell}>
      <a className={shellStyles.skipLink} href="#ai-settings">Skip to AI settings</a>
      <AppNavigation active="settings" csrfToken={loaderData.csrfToken} selectedDate={loaderData.today} today={loaderData.today} />
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
          <p>Shared by everyone on this tracker. Managed by the administrator.</p>
          {error ? <p role="alert" className={styles.error}>{error}</p> : null}
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
          <p className={styles.note}>Saved across app updates. Disconnecting keeps your meals.</p>
        </section>
        <SettingsDestinations active="ai" csrfToken={loaderData.csrfToken} isAdministrator />
      </main>
    </div>
  );
}
