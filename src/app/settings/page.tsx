import Link from "next/link";
import AppShell from "@/app/AppShell";
import styles from "./settings.module.css";

export default function SettingsPage() {
  return (
    <AppShell>
      <div className={styles.page}>
        <div className={styles.pageInner}>
          <header className={styles.pageHeader}>
            <div>
              <h1>Settings</h1>
              <p>Keep the comparison rules and body-weight history separate from the daily ledger.</p>
            </div>
            <Link className={styles.backLink} href="/">Back to Daily Log</Link>
          </header>
          <div className={styles.settingsPanel}>
            <div className={styles.settingsHeading}>
              <div>
                <h2>Choose a record</h2>
                <p>Targets evaluate each day. Weight tracks one dated reading at a time.</p>
              </div>
            </div>
            <div className={styles.settingsLinks}>
              <Link href="/settings/targets"><strong>Daily targets</strong><span>Calories, macros, sodium, and water limits</span></Link>
              <Link href="/settings/weight"><strong>Weight progress</strong><span>Dated pounds, trend, and optional target line</span></Link>
            </div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
