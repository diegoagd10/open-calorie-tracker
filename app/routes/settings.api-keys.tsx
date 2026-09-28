import { useState } from "react";
import { data, Form, Link, redirect, useActionData } from "react-router";
import type { Route } from "./+types/settings.api-keys";
import { getApplicationMutationSession, readApplicationMutationForm, requireApplicationSession } from "../auth/http.server";
import type { ApiKeyErrors, ApiKeySummary } from "../api-keys/api-keys.server";
import { API_KEY_SCOPES, DEFAULT_EXPIRATION, EXPIRATION_PRESETS, MAX_API_KEYS_PER_ACCOUNT } from "../api-keys/presets";
import { copyText, requestApiKey } from "../api-keys/copy.client";
import { getApiKeys } from "../api-keys/runtime.server";
import { applicationOrigin } from "../runtime.server";
import { SettingsDestinations, SettingsShell } from "../settings-destinations";
import { navigationToday } from "../goals/runtime.server";
import styles from "../account.module.css";
import shellStyles from "../food-log.module.css";

type ActionData = { errors: ApiKeyErrors };

export function meta() {
  return [{ title: "API keys · Open Calorie Tracker" }];
}

export function headers() {
  return { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireApplicationSession(request);
  const search = new URL(request.url).searchParams;
  const origin = applicationOrigin();
  const apiKeys = await getApiKeys();
  return {
    csrfToken: session.csrfToken,
    isAdministrator: session.user.role === "admin",
    today: navigationToday(session.user.id),
    timeZone: apiKeys.displayTimeZone(session.user.id),
    keys: apiKeys.list(session.user.id),
    mcpUrl: `${origin}/mcp`,
    apiUrl: `${origin}/api/v1/daily-log`,
    view: search.get("view") === "new" ? "new" as const : "list" as const,
    created: search.get("created") === "1",
  };
}

export async function action({ request }: Route.ActionArgs) {
  const session = await getApplicationMutationSession(request);
  if (session instanceof Response) throw session;
  const form = await readApplicationMutationForm(request, session);
  if (form.get("intent") !== "create") {
    return data<ActionData>({ errors: { form: "Unsupported action." } }, { status: 400 });
  }
  const result = (await getApiKeys()).create(session.user.id, {
    name: String(form.get("name") ?? ""),
    scopes: form.getAll("scope").map(String),
    expiration: String(form.get("expiration") ?? ""),
  });
  if (!result.ok) return data<ActionData>({ errors: result.errors }, { status: 400 });
  return redirect("/settings/api-keys?created=1");
}

function formatDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone }).format(new Date(value));
}

function scopeLabel(scope: ApiKeySummary["scopes"][number]) {
  return API_KEY_SCOPES.find((entry) => entry.scope === scope)?.label ?? scope;
}

function CopyButton({ label, value }: { label: string; value: () => Promise<string> }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return (
    <>
      <button
        className={styles.copyButton}
        type="button"
        aria-label={label}
        onClick={() => {
          copyText(value).then(() => setState("copied"), () => setState("failed"));
        }}
      >
        Copy
      </button>
      {state === "copied" ? <span className={styles.copyNotice} role="status">Copied</span> : null}
      {state === "failed" ? <span className={styles.copyNotice} role="alert">Could not copy</span> : null}
    </>
  );
}

export default function ApiKeysSettings({ loaderData }: Route.ComponentProps) {
  const result = useActionData<typeof action>();
  const { csrfToken, timeZone } = loaderData;
  return (
    <SettingsShell
      active="api-keys"
      csrfToken={csrfToken}
      isAdministrator={loaderData.isAdministrator}
      skipLabel="Skip to API keys"
      skipTarget="api-keys-settings"
      today={loaderData.today}
    >
      <main className={shellStyles.appSurface} id="api-keys-settings">
      <section className={styles.settingsPanel} aria-labelledby="api-keys-title">
        {loaderData.view === "new" ? (
          <>
            <Link className={styles.backLink} to="/settings/api-keys">All API keys</Link>
            <h1 id="api-keys-title">Create API key</h1>
            <Form className={styles.form} method="post">
              <input type="hidden" name="intent" value="create" />
              <input type="hidden" name="csrfToken" value={csrfToken} />
              <div className={styles.field}>
                <label htmlFor="api-key-name">Name</label>
                <input id="api-key-name" name="name" required maxLength={80} />
                {result?.errors.name ? <p role="alert">{result.errors.name}</p> : null}
              </div>
              <fieldset className={`${styles.field} ${styles.permissions}`}>
                <legend>Permissions</legend>
                {API_KEY_SCOPES.map((entry) => (
                  <label className={styles.checkboxRow} key={entry.scope}>
                    <input type="checkbox" checked disabled readOnly />
                    <input type="hidden" name="scope" value={entry.scope} />
                    {entry.label}
                  </label>
                ))}
                <small>More permissions coming soon</small>
                {result?.errors.scopes ? <p role="alert">{result.errors.scopes}</p> : null}
              </fieldset>
              <div className={styles.field}>
                <label htmlFor="api-key-expiration">Expiration</label>
                <select id="api-key-expiration" name="expiration" defaultValue={DEFAULT_EXPIRATION}>
                  {EXPIRATION_PRESETS.map((preset) => <option key={preset.value} value={preset.value}>{preset.label}</option>)}
                </select>
                {result?.errors.expiration ? <p role="alert">{result.errors.expiration}</p> : null}
              </div>
              {result?.errors.form ? <p role="alert" className={styles.error}>{result.errors.form}</p> : null}
              <button className={styles.submit} type="submit">Create key</button>
            </Form>
          </>
        ) : (
          <>
            <Link className={styles.backLink} to="/settings/goals">Back to settings</Link>
            <h1 id="api-keys-title">API keys</h1>
            <p className={styles.apiKeyHelp}>
              Send a key as <code>Authorization: Bearer &lt;key&gt;</code>
              <CopyButton label="Copy bearer header" value={() => Promise.resolve("Authorization: Bearer <key>")} />
              {" "}to <code>{loaderData.mcpUrl}</code>
              <CopyButton label="Copy MCP URL" value={() => Promise.resolve(loaderData.mcpUrl)} />
              {" "}or <code>{loaderData.apiUrl}</code>
              <CopyButton label="Copy API URL" value={() => Promise.resolve(loaderData.apiUrl)} />
            </p>
            {loaderData.created ? <p role="status" className={styles.success}>API key created. Use Copy to put it on your clipboard.</p> : null}
            {loaderData.keys.length < MAX_API_KEYS_PER_ACCOUNT
              ? <Link className={styles.primaryLink} to="/settings/api-keys?view=new">Create key</Link>
              : <p>You have {MAX_API_KEYS_PER_ACCOUNT} keys, the most an account can hold.</p>}
            {loaderData.keys.length ? (
              <ul className={styles.clientList}>
                {loaderData.keys.map((key) => (
                  <li className={styles.clientCard} key={key.id}>
                    <h2>{key.name}</h2>
                    <div className={styles.keyValue}>
                      <code className={styles.credential}>{key.maskedKey}</code>
                      <CopyButton label={`Copy ${key.name}`} value={() => requestApiKey(csrfToken, key.id)} />
                    </div>
                    <p>Permissions: {key.scopes.map(scopeLabel).join(", ")}</p>
                    <p>
                      Created {formatDate(key.createdAt, timeZone)}
                      {" · "}{key.expiresAt ? `Expires ${formatDate(key.expiresAt, timeZone)}` : "No expiration"}
                      {" · "}Last used {key.lastUsedAt ? formatDate(key.lastUsedAt, timeZone) : "—"}
                    </p>
                  </li>
                ))}
              </ul>
            ) : <p>No API keys yet.</p>}
          </>
        )}
      </section>
      <SettingsDestinations
        active="api-keys"
        csrfToken={csrfToken}
        isAdministrator={loaderData.isAdministrator}
      />
      </main>
    </SettingsShell>
  );
}
