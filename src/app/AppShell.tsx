import Link from "next/link";
import styles from "./app-shell.module.css";

function Mark() {
  return (
    <span className={styles.mark} aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.app}>
      <header className={styles.mobileHeader}>
        <Link className={styles.wordmark} href="/">
          <Mark />
          <span>Daily Intake</span>
        </Link>
        <span className={styles.mobileTag}>Personal ledger</span>
      </header>
      <div className={styles.frame}>
        <aside className={styles.sidebar} aria-label="Primary navigation">
          <Link className={styles.wordmark} href="/">
            <Mark />
            <span>Daily Intake</span>
          </Link>
          <p className={styles.sidebarCaption}>A quiet record of what matters today.</p>
          <nav className={styles.nav}>
            <Link href="/">Daily Log</Link>
            <Link href="/foods">Food Database</Link>
            <div className={styles.navGroup}>
              <span>Settings</span>
              <Link href="/settings/targets">Targets</Link>
              <Link href="/settings/weight">Weight</Link>
            </div>
          </nav>
          <p className={styles.sidebarFoot}>Local only · no account required</p>
        </aside>
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
