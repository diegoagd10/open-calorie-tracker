import { useEffect, useState } from "react";
import { Form, useNavigation } from "react-router";

import type { PipelineResult, ProviderComparisonResult, ProviderDemoStatus } from "./provider-pipeline-demo.server";
import styles from "./provider-pipeline-demo.module.css";

export type ProviderPipelineDemoActionData = { error?: string; message?: string; demo?: ProviderComparisonResult } | undefined;

function Status({ configured, label }: { configured: boolean; label: string }) {
  return <span className={configured ? styles.connected : styles.missing}>{configured ? label : "Not configured"}</span>;
}

function percentage(value: number | null) {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

export function ProviderPipelineDemoView({
  actionData,
  csrfToken,
  piConnected,
  status,
}: {
  actionData: ProviderPipelineDemoActionData;
  csrfToken: string;
  piConnected: boolean;
  status: ProviderDemoStatus;
}) {
  const navigation = useNavigation();
  const [preview, setPreview] = useState<string>();
  const intent = String(navigation.formData?.get("intent") ?? "");
  const busy = navigation.state !== "idle";
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <span className={styles.badge}>Functional experiment</span>
          <h1>One photo, three pipelines</h1>
          <p>Compare the current Pi workflow, Gemini alone, and Gemini with Jev using the exact same image and the same product-preview format.</p>
        </div>
        <a href="/settings/ai">Exit demo</a>
      </header>

      <p className={styles.disclosure}><strong>Controlled comparison:</strong> Pi and Gemini receive the same photo. Gemini runs once; its extraction becomes the Gemini-only draft and also feeds the Jev branch. Jev receives text and local USDA candidates, never the photo. Nothing is saved to the food log.</p>

      {actionData?.error ? <p className={styles.error} role="alert">{actionData.error}</p> : null}
      {actionData?.message ? <p className={styles.message} role="status">{actionData.message}</p> : null}

      <section className={styles.providerGrid} aria-label="Pipeline providers">
        <div><strong>Current Pi</strong><span>Existing image analysis with USDA tools</span><Status configured={piConnected} label="Connected" /></div>
        <div><strong>Gemini</strong><span>Visual quantities and nutrition estimates</span><Status configured={status.geminiConfigured} label="Configured" /></div>
        <div><strong>Gemini + Jev</strong><span>Gemini extraction, USDA shortlist, Jev selection</span><Status configured={status.geminiConfigured && status.jevConfigured} label="Configured" /></div>
      </section>

      <div className={styles.forms}>
        <Form method="post" className={styles.card}>
          <input type="hidden" name="csrfToken" value={csrfToken} />
          <h2>1. Provider keys</h2>
          <p>Saved only on this server with owner-only file permissions. Existing keys never return to this page.</p>
          <label>Google AI Studio key
            <input name="geminiApiKey" type="password" autoComplete="off" placeholder={status.geminiConfigured ? "Configured — leave blank to keep" : "Paste Gemini API key"} />
          </label>
          <label>TypeSafe key
            <input name="jevApiKey" type="password" autoComplete="off" placeholder={status.jevConfigured ? "Configured — leave blank to keep" : "Paste Jev API key"} />
          </label>
          <div className={styles.actions}>
            <button className={styles.primary} disabled={busy} name="intent" value="save-provider-keys">{busy && intent === "save-provider-keys" ? "Saving…" : status.ready ? "Update keys" : "Save keys"}</button>
            {status.ready ? <button disabled={busy} name="intent" value="remove-provider-keys">Remove keys</button> : null}
          </div>
        </Form>

        <Form method="post" encType="multipart/form-data" className={styles.card}>
          <input type="hidden" name="csrfToken" value={csrfToken} />
          <input type="hidden" name="intent" value="run-provider-demo" />
          <h2>2. Run the comparison</h2>
          <p>The same JPEG, PNG, or WebP runs through all three pipelines. Each result reports its own end-to-end time.</p>
          <label className={styles.fileField}>Meal photo
            <input
              name="photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              required
              onChange={(event) => {
                if (preview) URL.revokeObjectURL(preview);
                const file = event.currentTarget.files?.[0];
                setPreview(file ? URL.createObjectURL(file) : undefined);
              }}
            />
          </label>
          {preview ? <img className={styles.preview} src={preview} alt="Selected meal preview" /> : <div className={styles.emptyPreview}>Choose a meal photo to preview it here.</div>}
          <button className={styles.primary} disabled={busy || !status.ready || !piConnected} type="submit">{busy && intent === "run-provider-demo" ? "Running three pipelines…" : "Compare all three"}</button>
          {!status.ready || !piConnected ? <small>Connect Pi and save both provider keys first.</small> : null}
        </Form>
      </div>

      {actionData?.demo ? <DemoResults demo={actionData.demo} /> : null}
    </div>
  );
}

function formatNumber(value: number | null, suffix: string) {
  return value === null ? "—" : `${Math.round(value * 10) / 10}${suffix}`;
}

function DemoResults({ demo }: { demo: ProviderComparisonResult }) {
  return (
    <section className={styles.results} aria-labelledby="demo-results-heading">
      <div className={styles.resultHeader}>
        <div><span className={styles.badge}>Side-by-side output</span><h2 id="demo-results-heading">What each pipeline would create</h2></div>
        <span>Total wall time {formatNumber(demo.totalElapsedMs / 1000, "s")}</span>
      </div>
      <div className={styles.comparisonGrid}>
        {demo.pipelines.map(pipeline => <PipelineCard key={pipeline.id} pipeline={pipeline} />)}
      </div>
    </section>
  );
}

function PipelineCard({ pipeline }: { pipeline: PipelineResult }) {
  const product = pipeline.product;
  return (
    <article className={styles.pipelineResult}>
      <header>
        <div><span className={styles.step}>{pipeline.model}</span><h3>{pipeline.label}</h3></div>
        <strong>{formatNumber(pipeline.elapsedMs / 1000, "s")}</strong>
      </header>
      {pipeline.status === "failed" ? <p className={styles.pipelineError}>{pipeline.error}</p> : null}
      {pipeline.status === "no_food" ? <p className={styles.noFood}>No food detected.</p> : null}
      {product ? <>
        <h4>{product.name}</h4>
        <div className={styles.macros}>
          <div><strong>{formatNumber(product.totals.energyKcal, "")}</strong><span>kcal</span></div>
          <div><strong>{formatNumber(product.totals.proteinGrams, "g")}</strong><span>protein</span></div>
          <div><strong>{formatNumber(product.totals.carbohydrateGrams, "g")}</strong><span>carbs</span></div>
          <div><strong>{formatNumber(product.totals.fatGrams, "g")}</strong><span>fat</span></div>
        </div>
        <ol className={styles.components}>{product.components.map((component, index) => <li key={`${component.name}-${index}`}>
          <span><strong>{component.name}</strong><small>{component.quantity} {component.unit} · {component.source}</small></span>
          <b>{formatNumber(component.energyKcal, " kcal")}</b>
        </li>)}</ol>
        {pipeline.matches?.length ? <details><summary>Show Jev matches</summary><ul className={styles.matches}>{pipeline.matches.map(match => <li key={match.observed}><span>{match.observed} → {match.selected ?? "Gemini fallback"}</span><strong>{percentage(match.confidence)}</strong></li>)}</ul></details> : null}
        {product.assumptions.length ? <details><summary>Show assumptions</summary><ul>{product.assumptions.map(assumption => <li key={assumption}>{assumption}</li>)}</ul></details> : null}
      </> : null}
    </article>
  );
}
