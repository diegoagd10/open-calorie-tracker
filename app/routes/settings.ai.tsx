import { useEffect, useId, useRef, useState } from "react";
import { data, Form, Link, useNavigation } from "react-router";
import { z } from "zod";
import type { Route } from "./+types/settings.ai";
import { AppNavigation } from "../app-navigation";
import { requireAdministratorSession, requireValidOrigin } from "../auth/http.server";
import { getAuthenticationService } from "../auth/runtime.server";
import {
  ModelDiscoveryError,
  PhotoAnalysisConfigurationInputError,
  type ModelOption,
  type PhotoAnalysisConfigurationFieldErrors,
  type PhotoAnalysisSettingsSnapshot,
} from "../photo-analysis/configuration.server";
import {
  PhotoAnalysisCredentialInputError,
  PhotoAnalysisCredentialValidationError,
  type PhotoAnalysisCredentialPair,
} from "../photo-analysis/credentials.server";
import { getPhotoAnalysisConfiguration, getPhotoAnalysisCredentials, getPhotoAnalysisCredentialStatus, getPhotoAnalysisReadiness } from "../photo-analysis/runtime.server";
import { presentPhotoAnalysisReadiness } from "./photo-analysis-readiness";
import { SettingsDestinations } from "../settings-destinations";
import shellStyles from "../food-log.module.css";
import styles from "../photo-analysis/connection.module.css";

export function meta() { return [{ title: "AI photo estimates · Open Calorie Tracker" }]; }
export function headers() { return { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" }; }

type AiSettingsActionData = {
  area?: "credentials" | "configuration";
  error?: string;
  success?: string;
  fieldErrors?: Partial<Record<keyof PhotoAnalysisCredentialPair, string>> & PhotoAnalysisConfigurationFieldErrors;
};

const modelIdentifierSchema = z.string().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/u);
const thresholdFormSchema = z.string().min(1).transform(value => Number(value)).pipe(z.number().finite().min(0).max(1));
const configurationFormSchema = z.object({
  geminiModel: modelIdentifierSchema,
  jevModel: modelIdentifierSchema,
  categoryConfidenceThreshold: thresholdFormSchema,
  productConfidenceThreshold: thresholdFormSchema,
}).strict();

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireAdministratorSession(request);
  const credentials = await getPhotoAnalysisCredentialStatus();
  const settings = credentials.state === "configured"
    ? await (await getPhotoAnalysisConfiguration()).readSettings()
    : undefined;
  const readiness = presentPhotoAnalysisReadiness(
    await getPhotoAnalysisReadiness({ credentials, settings }),
    "admin",
  );
  return {
    csrfToken: session.csrfToken,
    today: new Date().toISOString().slice(0, 10),
    credentials,
    readiness,
    settings,
  };
}

export async function action({ request }: Route.ActionArgs) {
  requireValidOrigin(request);
  const session = await requireAdministratorSession(request);
  const form = await request.formData();
  if (!getAuthenticationService().verifyCsrfToken(session.token, String(form.get("csrfToken") ?? ""))) {
    throw new Response("CSRF token rejected.", { status: 403 });
  }
  const intent = form.get("intent");
  let credentials;
  try {
    credentials = await getPhotoAnalysisCredentials();
  } catch {
    return data<AiSettingsActionData>({
      area: intent === "save-configuration" ? "configuration" : "credentials",
      error: "Credential storage is unavailable. Repair the master-key path and try again.",
    }, { status: 503 });
  }
  switch (intent) {
    case "save-credentials":
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
    case "delete-credentials":
      if (form.get("confirmation") !== "delete") {
        return data<AiSettingsActionData>({ area: "credentials", error: "Confirm deletion before removing the shared credentials." }, { status: 400 });
      }
      try {
        await credentials.remove();
        return data<AiSettingsActionData>({ area: "credentials", success: "Photo Analysis credentials deleted." });
      } catch {
        return data<AiSettingsActionData>({ area: "credentials", error: "Credentials could not be deleted. The previous pair remains active." }, { status: 503 });
      }
    case "save-configuration":
      try {
        const candidate = parseConfigurationForm({
          geminiModel: String(form.get("geminiModel") ?? ""),
          jevModel: String(form.get("jevModel") ?? ""),
          categoryConfidenceThreshold: form.get("categoryConfidenceThreshold"),
          productConfidenceThreshold: form.get("productConfidenceThreshold"),
        });
        await (await getPhotoAnalysisConfiguration()).save(candidate);
        return data<AiSettingsActionData>({ area: "configuration", success: "Photo Analysis model settings saved for future attempts." });
      } catch (error) {
        if (error instanceof PhotoAnalysisConfigurationInputError) {
          return data<AiSettingsActionData>({ area: "configuration", error: error.message, fieldErrors: error.fieldErrors }, { status: 400 });
        }
        if (error instanceof ModelDiscoveryError) {
          const permanent = error.kind === "permanent-incompatibility";
          return data<AiSettingsActionData>({
            area: "configuration",
            error: permanent
              ? "Provider model discovery is incompatible with the current credentials or API. The previous settings remain active."
              : "Model availability could not be refreshed. The previous settings remain active.",
          }, { status: permanent ? 409 : 503 });
        }
        return data<AiSettingsActionData>({ area: "configuration", error: "Model settings could not be saved. The previous settings remain active." }, { status: 503 });
      }
    default:
      return data<AiSettingsActionData>({ error: "Unsupported action." }, { status: 400 });
  }
}

function parseConfigurationForm(candidate: {
  geminiModel: string;
  jevModel: string;
  categoryConfidenceThreshold: FormDataEntryValue | null;
  productConfidenceThreshold: FormDataEntryValue | null;
}) {
  const parsed = configurationFormSchema.safeParse(candidate);
  if (parsed.success) return parsed.data;
  const fields = z.flattenError(parsed.error).fieldErrors;
  throw new PhotoAnalysisConfigurationInputError({
    geminiModel: fields.geminiModel?.[0] ? "Enter a valid Gemini model identifier." : undefined,
    jevModel: fields.jevModel?.[0] ? "Enter a valid Jev model identifier." : undefined,
    categoryConfidenceThreshold: fields.categoryConfidenceThreshold?.[0] ? "Enter a value from 0.0 through 1.0." : undefined,
    productConfidenceThreshold: fields.productConfidenceThreshold?.[0] ? "Enter a value from 0.0 through 1.0." : undefined,
  });
}

function statusLabel(state: "configured" | "unconfigured" | "unreadable" | "storage-unavailable") {
  if (state === "configured") return "Configured";
  if (state === "unreadable") return "Needs re-entry";
  if (state === "storage-unavailable") return "Needs repair";
  return "Not configured";
}

type ModelComboboxProps = {
  label: string;
  name: "geminiModel" | "jevModel";
  models: ModelOption[];
  value: string;
  onChange: (value: string) => void;
  describedBy?: string;
};

function ModelCombobox({ label, name, models, value, onChange, describedBy }: ModelComboboxProps) {
  const id = useId();
  const listId = `${id}-options`;
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const query = value.toLocaleLowerCase();
  const filtered = models.filter(model => `${model.label} ${model.id}`.toLocaleLowerCase().includes(query));
  const choose = (model: ModelOption) => { onChange(model.id); setOpen(false); setActive(0); };
  return (
    <div className={styles.modelField}>
      <label htmlFor={id}>{label}</label>
      <div className={styles.comboboxControl}>
        <input
          id={id}
          name={name}
          type="search"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-activedescendant={open && filtered[active] ? `${id}-option-${active}` : undefined}
          aria-describedby={describedBy}
          value={value}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 0)}
          onChange={event => { onChange(event.target.value); setOpen(true); setActive(0); }}
          onKeyDown={event => {
            if (event.key === "ArrowDown") {
              event.preventDefault(); setOpen(true);
              setActive(index => Math.min(index + 1, Math.max(0, filtered.length - 1)));
            } else if (event.key === "ArrowUp") {
              event.preventDefault(); setActive(index => Math.max(0, index - 1));
            } else if (event.key === "Enter" && open && filtered[active]) {
              event.preventDefault(); choose(filtered[active]);
            } else if (event.key === "Escape") setOpen(false);
          }}
        />
        <span aria-hidden="true" className={styles.comboboxChevron}>⌄</span>
      </div>
      {open ? (
        <ul id={listId} role="listbox" aria-label={`${label} options`}>
          {filtered.length ? filtered.map((model, index) => (
            <li
              id={`${id}-option-${index}`}
              key={model.id}
              role="option"
              aria-selected={model.id === value}
              data-active={index === active || undefined}
              onMouseDown={event => event.preventDefault()}
              onClick={() => choose(model)}
            >
              <span>{model.label}</span>{model.lowLatency ? <small>Low latency</small> : null}
            </li>
          )) : <li className={styles.note}>No matching available models</li>}
        </ul>
      ) : null}
    </div>
  );
}

function ConfigurationForm({ settings, csrfToken, pending, actionData }: {
  settings: PhotoAnalysisSettingsSnapshot;
  csrfToken: string;
  pending: boolean;
  actionData?: AiSettingsActionData;
}) {
  const [geminiModel, setGeminiModel] = useState(settings.configuration.geminiModel);
  const [jevModel, setJevModel] = useState(settings.configuration.jevModel);
  const [categoryThreshold, setCategoryThreshold] = useState(settings.configuration.categoryConfidenceThreshold);
  const [productThreshold, setProductThreshold] = useState(settings.configuration.productConfidenceThreshold);
  const [calibrated, setCalibrated] = useState(settings.configuration.calibrated);
  useEffect(() => {
    setGeminiModel(settings.configuration.geminiModel);
    setJevModel(settings.configuration.jevModel);
    setCategoryThreshold(settings.configuration.categoryConfidenceThreshold);
    setProductThreshold(settings.configuration.productConfidenceThreshold);
    setCalibrated(settings.configuration.calibrated);
  }, [settings]);
  const selectJev = (model: string) => {
    setJevModel(model);
    const profile = settings.profiles[model];
    setCategoryThreshold(profile?.categoryConfidenceThreshold ?? 0);
    setProductThreshold(profile?.productConfidenceThreshold ?? 0);
    setCalibrated(profile?.calibrated ?? false);
  };
  const errors = actionData?.area === "configuration" ? actionData.fieldErrors : undefined;
  const available = settings.gemini.state === "available" && settings.jev.state === "available";
  const geminiSelectionValid = settings.gemini.models.some(model => model.id === geminiModel);
  const jevSelectionValid = settings.jev.models.some(model => model.id === jevModel);
  return (
    <Form method="post" className={styles.credentialForm} noValidate>
      <input type="hidden" name="csrfToken" value={csrfToken} />
      <ModelCombobox label="Gemini model" name="geminiModel" models={settings.gemini.models} value={geminiModel} onChange={setGeminiModel} describedBy={errors?.geminiModel ? "gemini-model-error" : undefined} />
      {errors?.geminiModel ? <small id="gemini-model-error" className={styles.fieldError}>{errors.geminiModel}</small> : null}
      {!geminiSelectionValid && !errors?.geminiModel ? <small className={styles.fieldError}>Choose a Gemini model from the available options.</small> : null}
      <ModelCombobox label="Jev model" name="jevModel" models={settings.jev.models} value={jevModel} onChange={selectJev} describedBy={errors?.jevModel ? "jev-model-error" : undefined} />
      {errors?.jevModel ? <small id="jev-model-error" className={styles.fieldError}>{errors.jevModel}</small> : null}
      {!jevSelectionValid && !errors?.jevModel ? <small className={styles.fieldError}>Choose a Jev model from the available options.</small> : null}
      <p className={calibrated ? styles.success : styles.instructions} role="status">
        {calibrated ? `Saved calibration for ${jevModel}` : `${jevModel} is uncalibrated; both thresholds start at 0.0.`}
      </p>
      <div className={styles.credentialForm}>
        <label htmlFor="category-confidence">Category confidence threshold</label>
        <input id="category-confidence" name="categoryConfidenceThreshold" type="number" min="0" max="1" step="0.01" value={categoryThreshold} onChange={event => setCategoryThreshold(Number(event.target.value))} aria-describedby={`threshold-help${errors?.categoryConfidenceThreshold ? " category-threshold-error" : ""}`} />
        {errors?.categoryConfidenceThreshold ? <small id="category-threshold-error" className={styles.fieldError}>{errors.categoryConfidenceThreshold}</small> : null}
        <label htmlFor="product-confidence">Product confidence threshold</label>
        <input id="product-confidence" name="productConfidenceThreshold" type="number" min="0" max="1" step="0.01" value={productThreshold} onChange={event => setProductThreshold(Number(event.target.value))} aria-describedby={`threshold-help${errors?.productConfidenceThreshold ? " product-threshold-error" : ""}`} />
        {errors?.productConfidenceThreshold ? <small id="product-threshold-error" className={styles.fieldError}>{errors.productConfidenceThreshold}</small> : null}
      </div>
      <p id="threshold-help" className={styles.note}>0.0 accepts any non-none Jev choice regardless of distribution ambiguity. Higher values require a more concentrated probability distribution; if either category or product confidence is below its threshold, that component uses its Gemini estimate instead.</p>
      <button className={styles.primary} disabled={pending || !available || !geminiSelectionValid || !jevSelectionValid} name="intent" value="save-configuration">{pending ? "Saving…" : "Save model settings"}</button>
    </Form>
  );
}

export default function AiSettings({ loaderData, actionData }: Route.ComponentProps) {
  const navigation = useNavigation();
  const pending = navigation.state !== "idle";
  const fieldErrors = actionData?.area === "credentials" ? actionData.fieldErrors : undefined;
  const configuredStatus = loaderData.credentials.state === "configured" ? loaderData.credentials : undefined;
  const configured = configuredStatus !== undefined;
  const credentialForm = useRef<HTMLFormElement>(null);
  useEffect(() => { if (actionData?.area === "credentials") credentialForm.current?.reset(); }, [actionData]);
  const credentialError = actionData?.area === "credentials" ? actionData.error : undefined;
  const credentialSuccess = actionData?.area === "credentials" ? actionData.success : undefined;
  const configurationError = actionData?.area === "configuration" ? actionData.error : undefined;
  const configurationSuccess = actionData?.area === "configuration" ? actionData.success : undefined;
  return (
    <div className={shellStyles.shell}>
      <a className={shellStyles.skipLink} href="#ai-settings">Skip to AI settings</a>
      <AppNavigation active="settings" csrfToken={loaderData.csrfToken} selectedDate={loaderData.today} today={loaderData.today} />
      <main className={shellStyles.appSurface} id="ai-settings">
        <header className={shellStyles.mobileHeader}>
          <div className={shellStyles.titleLine}><h1>AI photo estimates</h1></div>
          <p className={shellStyles.selectedDateLabel}>Configure providers and matching confidence for future Photo Analysis attempts.</p>
        </header>
        <section className={styles.card} aria-labelledby="credentials-heading">
          <div className={styles.heading}><div><h2 id="credentials-heading">Photo Analysis credentials</h2><p>Gemini and TypeSafe</p></div><span className={configured ? styles.connected : styles.disconnected}>{statusLabel(loaderData.credentials.state)}</span></div>
          <p>Shared by everyone on this tracker. Saved keys are encrypted and are never shown again.</p>
          {loaderData.credentials.state === "unreadable" ? <p role="alert" className={styles.error}>The saved credential pair cannot be read. Enter and validate both keys again.</p> : null}
          {loaderData.credentials.state === "storage-unavailable" ? <p role="alert" className={styles.error}>Credential storage cannot use the configured master-key path. Repair it, then reload this page.</p> : null}
          {credentialError ? <p role="alert" className={styles.error}>{credentialError}</p> : null}
          {credentialSuccess ? <p role="status" className={styles.success}>{credentialSuccess}</p> : null}
          {configuredStatus ? <p className={styles.note}>Last validated {new Date(configuredStatus.validatedAt).toLocaleString()}.</p> : null}
          <Form method="post" className={styles.credentialForm} ref={credentialForm}>
            <input type="hidden" name="csrfToken" value={loaderData.csrfToken} />
            <label htmlFor="gemini-key">Gemini API key</label>
            <input id="gemini-key" name="geminiKey" type="password" autoComplete="new-password" minLength={16} maxLength={512} required aria-invalid={fieldErrors?.geminiKey ? true : undefined} aria-describedby={fieldErrors?.geminiKey ? "gemini-key-error" : undefined} />
            {fieldErrors?.geminiKey ? <small id="gemini-key-error" className={styles.fieldError}>{fieldErrors.geminiKey}</small> : null}
            <label htmlFor="typesafe-key">TypeSafe API key</label>
            <input id="typesafe-key" name="typeSafeKey" type="password" autoComplete="new-password" minLength={16} maxLength={512} required aria-invalid={fieldErrors?.typeSafeKey ? true : undefined} aria-describedby={fieldErrors?.typeSafeKey ? "typesafe-key-error" : undefined} />
            {fieldErrors?.typeSafeKey ? <small id="typesafe-key-error" className={styles.fieldError}>{fieldErrors.typeSafeKey}</small> : null}
            <button className={styles.primary} disabled={pending} name="intent" value="save-credentials">{pending ? "Validating…" : configured ? "Replace credential pair" : "Save credential pair"}</button>
          </Form>
          {loaderData.credentials.state !== "unconfigured" ? (
            <Form method="post" className={styles.deleteForm}>
              <input type="hidden" name="csrfToken" value={loaderData.csrfToken} />
              <label className={styles.confirmation}><input type="checkbox" name="confirmation" value="delete" required />I understand this disables new Photo Analysis credential consumers.</label>
              <button className={styles.destructive} disabled={pending} name="intent" value="delete-credentials">Delete credential pair</button>
            </Form>
          ) : null}
          <p className={styles.note}>Replacing or deleting this pair affects future attempts only. It never changes saved meals, Food Entries, or Photo Analysis history.</p>
        </section>
        <section className={styles.card} aria-labelledby="models-heading">
          <div className={styles.heading}><div><h2 id="models-heading">Models and confidence</h2><p>Future Photo Analysis attempts</p></div><span className={loaderData.settings?.ready ? styles.connected : styles.disconnected}>{loaderData.settings?.ready ? "Ready" : "Not ready"}</span></div>
          {!loaderData.settings ? <p role="status">Save a valid credential pair to discover available models.</p> : (
            <>
              {!loaderData.settings.ready && loaderData.settings.reason ? <p role="alert" className={styles.error}>{loaderData.settings.reason}</p> : null}
              {configurationError ? <p role="alert" className={styles.error}>{configurationError}</p> : null}
              {configurationSuccess ? <p role="status" className={styles.success}>{configurationSuccess}</p> : null}
              <ConfigurationForm settings={loaderData.settings} csrfToken={loaderData.csrfToken} pending={pending} actionData={actionData} />
            </>
          )}
          <p className={styles.note}>Model and threshold changes apply only to future attempts and never recalculate saved meals.</p>
        </section>
        <section className={styles.card} aria-labelledby="readiness-heading">
          <div className={styles.heading}>
            <div>
              <h2 id="readiness-heading">AI photo availability</h2>
              <p>Can members use AI photo from Add Food?</p>
            </div>
            <span className={loaderData.readiness.state === "ready" ? styles.connected : styles.disconnected}>
              {loaderData.readiness.state === "ready" ? "Available" : "Unavailable"}
            </span>
          </div>
          {loaderData.readiness.state === "ready" ? (
            <p>AI photo is available. Members can start a photo estimate from Add Food.</p>
          ) : (
            <p role="alert" className={styles.error}>
              <strong>AI photo is hidden from Add Food until this is fixed.</strong>{" "}
              {loaderData.readiness.reason}{" "}
              {loaderData.readiness.destination && loaderData.readiness.destination !== "/settings/ai" ? (
                <Link to={loaderData.readiness.destination}>Open Food Catalogs settings</Link>
              ) : null}
            </p>
          )}
          <p className={styles.note}>Changes affect new photos only. Meals already being analyzed continue with the settings they started with.</p>
        </section>
        <SettingsDestinations active="ai" csrfToken={loaderData.csrfToken} isAdministrator />
      </main>
    </div>
  );
}
