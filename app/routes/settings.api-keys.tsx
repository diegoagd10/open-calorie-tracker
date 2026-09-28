import { useState } from "react";
import { data, Form, Link, redirect, useActionData } from "react-router";
import type { Route } from "./+types/settings.api-keys";
import { getApplicationMutationSession, readApplicationMutationForm, requireApplicationSession } from "../auth/http.server";
import { MISSING_API_KEY, parseApiKeyId, type ApiKeyErrors, type ApiKeyOutcome, type ApiKeys, type ApiKeySummary, type ExpirationChoice } from "../api-keys/api-keys.server";
import { parseApiKeyFields } from "../api-keys/validation";
import { API_KEY_SCOPES, DEFAULT_EXPIRATION, EXPIRATION_PRESETS, MAX_API_KEYS_PER_ACCOUNT } from "../api-keys/presets";
import { copyText, requestApiKey } from "../api-keys/copy.client";
import { getApiKeys } from "../api-keys/runtime.server";
import { applicationOrigin } from "../runtime.server";
import { SettingsDestinations, SettingsShell } from "../settings-destinations";
import { navigationToday } from "../goals/runtime.server";
import styles from "../account.module.css";
import shellStyles from "../food-log.module.css";

type ActionData = { errors: ApiKeyErrors };

const LIST_PATH = "/settings/api-keys";
const COMPLETED = { create: "created", update: "updated", delete: "deleted" } as const;

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
  const keyId = parseApiKeyId(search.get("key"));
  const page = {
    csrfToken: session.csrfToken,
    isAdministrator: session.user.role === "admin",
    today: navigationToday(session.user.id),
    timeZone: apiKeys.displayTimeZone(session.user.id),
    keys: apiKeys.list(session.user.id),
    mcpUrl: `${origin}/mcp`,
    apiUrl: `${origin}/api/v1/daily-log`,
    created: search.get("created") === "1",
    updated: search.get("updated") === "1",
    deleted: search.get("deleted") === "1",
  };
  switch (search.get("view")) {
    case "new":
      return { ...page, view: "new" as const };
    case "edit": {
      const editing = keyId === undefined ? undefined : apiKeys.findEditable(session.user.id, keyId);
      if (!editing) throw redirect(LIST_PATH);
      return { ...page, view: "edit" as const, editing };
    }
    case "delete": {
      const key = keyId === undefined ? undefined : apiKeys.find(session.user.id, keyId);
      if (!key) throw redirect(LIST_PATH);
      return { ...page, view: "delete" as const, deleting: { id: key.id, name: key.name } };
    }
    default:
      return { ...page, view: "list" as const };
  }
}

/** Applies one form submission; name, permissions, and expiration are parsed here, before the service sees them. */
function changeKeys(apiKeys: ApiKeys, ownerId: number, intent: keyof typeof COMPLETED, form: FormData): ApiKeyOutcome {
  const keyId = parseApiKeyId(form.get("keyId"));
  if (intent === "delete") return keyId === undefined ? MISSING_API_KEY : apiKeys.delete(ownerId, keyId);
  if (intent === "update" && keyId === undefined) return MISSING_API_KEY;
  const fields = parseApiKeyFields(form);
  if (!fields.success) return { ok: false, errors: fields.errors };
  return keyId === undefined || intent === "create"
    ? apiKeys.create(ownerId, fields.data)
    : apiKeys.update(ownerId, keyId, fields.data);
}

export async function action({ request }: Route.ActionArgs) {
  const session = await getApplicationMutationSession(request);
  if (session instanceof Response) throw session;
  const form = await readApplicationMutationForm(request, session);
  const intent = form.get("intent");
  if (intent !== "create" && intent !== "update" && intent !== "delete") {
    return data<ActionData>({ errors: { form: "Unsupported action." } }, { status: 400 });
  }
  const result = changeKeys(await getApiKeys(), session.user.id, intent, form);
  if (!result.ok) return data<ActionData>({ errors: result.errors }, { status: result.missing ? 404 : 400 });
  return redirect(`${LIST_PATH}?${COMPLETED[intent]}=1`);
}

function formatDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeZone }).format(new Date(value));
}

function formatDateTime(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone }).format(new Date(value));
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

/** A URL kept on the same line as the button that copies it. */
function Endpoint({ label, url }: { label: string; url: string }) {
  return (
    <span className={styles.endpoint}>
      <code>{url}</code>
      <CopyButton label={label} value={() => Promise.resolve(url)} />
    </span>
  );
}

/** The name, permissions, and expiration fields shared by the create and edit forms. */
function KeyFields({ errors, name, scopes, expiration, expirations }: {
  errors: ApiKeyErrors | undefined;
  name?: string;
  scopes: readonly string[];
  expiration: string;
  expirations: ReadonlyArray<{ value: string; label: string }>;
}) {
  return (
    <>
      <div className={styles.field}>
        <label htmlFor="api-key-name">Name</label>
        <input id="api-key-name" name="name" required maxLength={80} defaultValue={name} />
        {errors?.name ? <p role="alert">{errors.name}</p> : null}
      </div>
      <fieldset className={`${styles.field} ${styles.permissions}`}>
        <legend>Permissions</legend>
        {API_KEY_SCOPES.length === 1 ? (
          <>
            {/* The only permission is always granted, so it is shown checked and submitted as a hidden value. */}
            <label className={styles.checkboxRow}>
              <input type="checkbox" checked disabled readOnly />
              <input type="hidden" name="scope" value={API_KEY_SCOPES[0].scope} />
              {API_KEY_SCOPES[0].label}
            </label>
            <small>More permissions coming soon</small>
          </>
        ) : API_KEY_SCOPES.map((entry) => (
          <label className={styles.checkboxRow} key={entry.scope}>
            <input type="checkbox" name="scope" value={entry.scope} defaultChecked={scopes.includes(entry.scope)} />
            {entry.label}
          </label>
        ))}
        {errors?.scopes ? <p role="alert">{errors.scopes}</p> : null}
      </fieldset>
      <div className={styles.field}>
        <label htmlFor="api-key-expiration">Expiration</label>
        <select id="api-key-expiration" name="expiration" defaultValue={expiration}>
          {expirations.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
        </select>
        {errors?.expiration ? <p role="alert">{errors.expiration}</p> : null}
      </div>
      {errors?.form ? <p role="alert" className={styles.error}>{errors.form}</p> : null}
    </>
  );
}

function expirationOption(choice: ExpirationChoice, timeZone: string) {
  return { value: choice.value, label: choice.expiresAt ? `${choice.label} · ${formatDate(choice.expiresAt, timeZone)}` : choice.label };
}

function KeyCard({ apiKey, csrfToken, timeZone }: { apiKey: ApiKeySummary; csrfToken: string; timeZone: string }) {
  const expiration = apiKey.expiresAt
    ? `${apiKey.expired ? "Expired" : "Expires"} ${formatDate(apiKey.expiresAt, timeZone)}`
    : "No expiration";
  return (
    <li className={apiKey.expired ? `${styles.keyCard} ${styles.expiredKey}` : styles.keyCard}>
      <h2>
        {apiKey.name}
        {apiKey.expired ? <span className={styles.expiredBadge}>Expired</span> : null}
      </h2>
      <div className={styles.keyValue}>
        <code className={styles.credential}>{apiKey.maskedKey}</code>
        {apiKey.expired ? null : <CopyButton label={`Copy ${apiKey.name}`} value={() => requestApiKey(csrfToken, apiKey.id)} />}
      </div>
      <p>Permissions: {apiKey.scopes.map(scopeLabel).join(", ")}</p>
      <p>
        Created {formatDate(apiKey.createdAt, timeZone)}
        {" · "}{expiration}
        {" · "}Last used {apiKey.lastUsedAt ? formatDateTime(apiKey.lastUsedAt, timeZone) : "—"}
      </p>
      <div className={styles.keyActions}>
        {apiKey.expired ? null : <Link aria-label={`Edit ${apiKey.name}`} to={`${LIST_PATH}?view=edit&key=${apiKey.id}`}>Edit</Link>}
        <Link aria-label={`Delete ${apiKey.name}`} className={styles.deleteKeyLink} to={`${LIST_PATH}?view=delete&key=${apiKey.id}`}>Delete</Link>
      </div>
    </li>
  );
}

function ListView({ loaderData }: { loaderData: Route.ComponentProps["loaderData"] }) {
  const { csrfToken, timeZone } = loaderData;
  const notice = loaderData.created
    ? "API key created. Use Copy to put it on your clipboard."
    : loaderData.updated ? "API key updated." : loaderData.deleted ? "API key deleted." : undefined;
  return (
    <>
      <Link className={styles.backLink} to="/settings/goals">Back to settings</Link>
      <h1 id="api-keys-title">API keys</h1>
      <p className={styles.apiKeyHelp}>
        Send a key as <code>Authorization: Bearer &lt;key&gt;</code> to{" "}
        <Endpoint label="Copy MCP URL" url={loaderData.mcpUrl} /> or{" "}
        <Endpoint label="Copy API URL" url={loaderData.apiUrl} />
      </p>
      {notice ? <p role="status" className={styles.success}>{notice}</p> : null}
      {loaderData.keys.length < MAX_API_KEYS_PER_ACCOUNT
        ? <Link className={styles.primaryLink} to={`${LIST_PATH}?view=new`}>Create key</Link>
        : <p>You have {MAX_API_KEYS_PER_ACCOUNT} keys, the most an account can hold.</p>}
      {loaderData.keys.length ? (
        <ul className={styles.apiKeyList}>
          {loaderData.keys.map((key) => <KeyCard apiKey={key} csrfToken={csrfToken} key={key.id} timeZone={timeZone} />)}
        </ul>
      ) : <p>No API keys yet.</p>}
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
            <Link className={styles.backLink} to={LIST_PATH}>All API keys</Link>
            <h1 id="api-keys-title">Create API key</h1>
            <Form className={styles.form} method="post">
              <input type="hidden" name="intent" value="create" />
              <input type="hidden" name="csrfToken" value={csrfToken} />
              <KeyFields errors={result?.errors} scopes={[]} expiration={DEFAULT_EXPIRATION} expirations={EXPIRATION_PRESETS} />
              <button className={styles.submit} type="submit">Create key</button>
            </Form>
          </>
        ) : loaderData.view === "edit" ? (
          <>
            <Link className={styles.backLink} to={LIST_PATH}>All API keys</Link>
            <h1 id="api-keys-title">Edit {loaderData.editing.key.name}</h1>
            <p>Changes apply on the key&apos;s next request. The key itself stays the same.</p>
            <Form className={styles.form} method="post">
              <input type="hidden" name="intent" value="update" />
              <input type="hidden" name="keyId" value={loaderData.editing.key.id} />
              <input type="hidden" name="csrfToken" value={csrfToken} />
              <KeyFields
                errors={result?.errors}
                name={loaderData.editing.key.name}
                scopes={loaderData.editing.key.scopes}
                expiration={loaderData.editing.expiration}
                expirations={loaderData.editing.expirations.map((choice) => expirationOption(choice, timeZone))}
              />
              <button className={styles.submit} type="submit">Save changes</button>
            </Form>
          </>
        ) : loaderData.view === "delete" ? (
          <>
            <Link className={styles.backLink} to={LIST_PATH}>All API keys</Link>
            <h1 id="api-keys-title">Delete {loaderData.deleting.name}?</h1>
            <p>Anything using this key stops working immediately. This cannot be undone.</p>
            {result?.errors.form ? <p role="alert" className={styles.error}>{result.errors.form}</p> : null}
            <Form className={styles.removalActions} method="post">
              <input type="hidden" name="intent" value="delete" />
              <input type="hidden" name="keyId" value={loaderData.deleting.id} />
              <input type="hidden" name="csrfToken" value={csrfToken} />
              <button className={styles.confirmRemovalButton} type="submit">Delete key</button>
              <Link className={styles.cancelRemovalButton} to={LIST_PATH}>Cancel</Link>
            </Form>
          </>
        ) : <ListView loaderData={loaderData} />}
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
