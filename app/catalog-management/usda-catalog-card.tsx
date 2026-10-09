import { useRef, useState, type ReactNode, type RefObject } from "react";
import { Form, useNavigation } from "react-router";
import { copyText } from "../api-keys/copy.client";
import type { InstalledCatalog } from "./catalog-management.server";
import {
  archiveSize, importCommand, releaseDate, releaseName, shortHash, shortReleaseName, timeAgo, usdaCatalogStatus,
  type UsdaCatalogInformation, type UsdaCatalogStatus,
} from "./usda-catalog-status";
import styles from "./usda-catalog-card.module.css";

const officialDownloads = "https://fdc.nal.usda.gov/download-datasets/";
const fallbackArchive = "FoodData_Central_foundation_food_csv.zip";

type Tone = "ok" | "warn" | "danger" | "neutral";
type Hero = { tone: Tone; icon: string; title: string; detail: string; action: "check" | "how" };

function hero(status: UsdaCatalogStatus, installed: InstalledCatalog | null, rechecked: boolean): Hero {
  const installedRelease = installed?.sourceRelease;
  switch (status.kind) {
    case "not-installed": return { tone: "neutral", icon: "+", title: "Not installed", detail: "Download the Foundation CSV ZIP from USDA, then install it from the terminal.", action: "check" };
    case "unbound": return { tone: "neutral", icon: "?", title: "Release unknown", detail: "The installed archive could not be tied to a declared USDA release.", action: "check" };
    case "unchecked": return { tone: "neutral", icon: "↻", title: "Not checked yet", detail: "USDA update status has not been checked.", action: "check" };
    case "current": return rechecked
      ? { tone: "ok", icon: "✓", title: "Still up to date", detail: "No newer release at USDA.", action: "check" }
      : { tone: "ok", icon: "✓", title: "Up to date", detail: `${installedRelease ? releaseName(installedRelease) : "This"} is the latest USDA release.`, action: "check" };
    case "newer": return { tone: "warn", icon: "↑", title: `New release: ${shortReleaseName(status.release)}`, detail: `Published ${releaseDate(status.release)}${installedRelease ? ` · you have ${shortReleaseName(installedRelease)}` : ""}`, action: "how" };
    case "unavailable": return { tone: "danger", icon: "!", title: "Couldn’t reach USDA", detail: "Your installed catalog keeps working. Try again later.", action: "check" };
    case "indeterminate": return { tone: "danger", icon: "!", title: "Couldn’t compare with USDA", detail: "USDA release metadata cannot be compared safely. Your installed catalog keeps working.", action: "check" };
  }
}

const checking: Hero = { tone: "neutral", icon: "", title: "Checking USDA…", detail: "Reading release metadata only. Nothing is downloaded.", action: "check" };
const toneClass: Record<Tone, string | undefined> = { ok: styles.ok, warn: styles.warn, danger: styles.danger, neutral: styles.neutral };

function checkLabel(status: UsdaCatalogStatus, checked: boolean): string {
  if (status.kind === "unavailable" || status.kind === "indeterminate") return "Try again";
  return checked ? "Check again" : "Check for updates";
}

function CheckForm({ csrfToken, label, busy }: { csrfToken: string; label: string; busy: boolean }) {
  return <Form method="post" action="/settings/catalogs" className={styles.checkForm}>
    <input type="hidden" name="csrfToken" value={csrfToken} />
    <button className={styles.button} type="submit" name="intent" value="check-usda-update" disabled={busy}>{busy ? "Checking…" : label}</button>
  </Form>;
}

function CopyButton({ label, value, children = "Copy" }: { label: string; value: string; children?: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  return <>
    <button className={styles.copy} type="button" aria-label={label} onClick={() => { copyText(() => Promise.resolve(value)).then(() => setState("copied"), () => setState("failed")); }}>{children}</button>
    {state === "copied" ? <span className={styles.copyNotice} role="status">Copied</span> : null}
    {state === "failed" ? <span className={styles.copyNotice} role="alert">Could not copy</span> : null}
  </>;
}

function Command({ filename }: { filename: string }) {
  const command = importCommand(filename);
  const [program, path] = command.split(" -- ");
  return <div className={styles.command}><code><span className={styles.nowrap}>{program} --</span> {path}</code><CopyButton label="Copy import command" value={command} /></div>;
}

function Step({ title, children }: { title: string; children: ReactNode }) {
  return <li><div><strong>{title}</strong>{children}</div></li>;
}

function InstallSteps({ heading, status, filename }: { heading: string; status: UsdaCatalogStatus; filename: string }) {
  return <>
    <h3 className={styles.subhead}>{heading}</h3>
    <ol className={`${styles.steps} ${status.kind === "newer" ? styles.stepsWarn : ""}`}>
      <Step title="Download the CSV ZIP">
        <p>Foundation Foods · CSV{status.kind === "newer" ? ` · ${archiveSize(status.release.archiveByteLength)}` : ""} · opens USDA in a new tab</p>
        <a className={styles.button} href={officialDownloads} target="_blank" rel="noreferrer">USDA downloads ↗</a>
      </Step>
      <Step title="Run this on the server"><p>Replace the path with where you saved the ZIP.</p><Command filename={filename} /></Step>
      <Step title="Come back here"><p>Search keeps working during the import. When it finishes, this card shows the new release and SHA-256.</p></Step>
    </ol>
  </>;
}

function Details({ installed, status, detailsRef }: { installed: InstalledCatalog | null; status: UsdaCatalogStatus; detailsRef: RefObject<HTMLDetailsElement | null> }) {
  const availableFilename = status.kind === "newer" ? status.release.archiveFilename : fallbackArchive;
  return <details className={styles.details} ref={detailsRef} open={!installed}>
    <summary>{installed ? "Details & how to update" : "How to install"}</summary>
    {installed ? <>
      <h3 className={styles.subhead}>Installed snapshot</h3>
      <dl className={styles.snapshot}>
        <dt>Archive</dt><dd className={styles.mono}>{installed.filename}</dd>
        <dt>Installed</dt><dd>{new Date(installed.installedAt).toLocaleString()}</dd>
        <dt>Food dates</dt><dd>{installed.publicationDateRange.earliest} – {installed.publicationDateRange.latest}</dd>
        <dt>SHA-256</dt><dd><span className={styles.mono}>{installed.sha256}</span> <CopyButton label="Copy SHA-256" value={installed.sha256} /></dd>
      </dl>
    </> : null}
    {!installed ? <InstallSteps heading="Install USDA Foundation" status={status} filename={availableFilename} />
      : status.kind === "newer" ? <InstallSteps heading={`Update to ${shortReleaseName(status.release)}`} status={status} filename={availableFilename} />
        : <>
          <h3 className={styles.subhead}>Reinstall this archive</h3>
          <ol className={styles.steps}><Step title="Run this on the server"><p>Only needed to repair or re-verify the catalog.</p><Command filename={installed.filename} /></Step></ol>
        </>}
    <p className={styles.note}>The app only checks USDA metadata; it never downloads or installs archives by itself. Saved Food Entries keep their original nutrition and measurements.</p>
  </details>;
}

function Stats({ installed, status, renderedAt }: { installed: InstalledCatalog; status: UsdaCatalogStatus; renderedAt: string }) {
  const installedAt = new Date(installed.installedAt);
  const release = installed.sourceRelease;
  return <div className={styles.stats}>
    <div className={styles.stat}>
      <span className={styles.label}>Installed</span>
      <strong>{timeAgo(installed.installedAt, renderedAt)}</strong>
      <span>{installedAt.toLocaleDateString(undefined, { dateStyle: "medium" })} · <span className={styles.nowrap}>{installedAt.toLocaleTimeString(undefined, { timeStyle: "short" })}</span></span>
    </div>
    <div className={`${styles.stat} ${status.kind === "newer" ? styles.statWarn : ""}`}>
      <span className={styles.label}>Release</span>
      <strong>{release ? shortReleaseName(release) : "Unknown"}</strong>
      <span>{status.kind === "newer" ? `${shortReleaseName(status.release)} available` : release ? releaseDate(release) : "Not declared"}</span>
    </div>
    <div className={styles.stat}>
      <span className={styles.label}>SHA-256</span>
      <strong className={styles.mono} title={installed.sha256}>{shortHash(installed.sha256)}</strong>
      <span><CopyButton label="Copy full SHA-256" value={installed.sha256}>Copy full hash</CopyButton></span>
    </div>
  </div>;
}

/** The USDA Foundation card: status first, three key facts, and provenance plus instructions on demand. */
export function UsdaCatalogCard({ catalog, csrfToken, renderedAt, rechecked }: { catalog: UsdaCatalogInformation; csrfToken: string; renderedAt: string; rechecked: boolean }) {
  const navigation = useNavigation();
  const busy = navigation.formData?.get("intent") === "check-usda-update";
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const { installed, updateCheck } = catalog;
  const status = usdaCatalogStatus(catalog);
  const shown = busy ? checking : hero(status, installed, rechecked);
  const label = checkLabel(status, Boolean(updateCheck));
  const openInstructions = () => {
    if (!detailsRef.current) return;
    detailsRef.current.open = true;
    detailsRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return <section className={styles.card} aria-labelledby="usda-fdc-heading">
    <div className={styles.heading}>
      <h2 id="usda-fdc-heading">USDA Foundation</h2>
      {installed ? <span className={styles.count}>{installed.foodCount.toLocaleString()} foods installed</span> : null}
    </div>
    <div className={`${styles.hero} ${toneClass[shown.tone] ?? ""} ${rechecked && !busy && status.kind === "current" ? styles.flash : ""}`} aria-live="polite">
      <span className={styles.icon} aria-hidden="true">{busy ? <span className={styles.spinner} /> : shown.icon}</span>
      <div><strong>{shown.title}</strong><span>{shown.detail}</span></div>
      {shown.action === "how" && !busy
        ? <button className={`${styles.button} ${styles.primary}`} type="button" onClick={openInstructions}>How to update</button>
        : <CheckForm csrfToken={csrfToken} label={label} busy={busy} />}
    </div>
    {installed ? <Stats installed={installed} status={status} renderedAt={renderedAt} /> : null}
    <div className={styles.meta}>
      <span>
        {updateCheck ? <span title={new Date(updateCheck.checkedAt).toLocaleString()}>Last checked {timeAgo(updateCheck.checkedAt, renderedAt)}</span> : "USDA has not been checked"}
        {shown.action === "how" && !busy ? <CheckForm csrfToken={csrfToken} label="Check again" busy={false} /> : null}
      </span>
      <a href={officialDownloads} target="_blank" rel="noreferrer">Official USDA downloads ↗</a>
    </div>
    <Details installed={installed} status={status} detailsRef={detailsRef} />
  </section>;
}
