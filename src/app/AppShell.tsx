"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
  const pathname = usePathname();
  const isActive = (href: string) =>
    pathname === href || (href !== "/" && pathname.startsWith(href));

  return (
    <div className={styles.app}>
      <header className={styles.mobileHeader}>
        <div className={styles.mobileHeaderTop}>
          <Link className={styles.wordmark} href="/">
            <Mark />
            <span>Daily Intake</span>
          </Link>
          <span className={styles.mobileTag}>Personal ledger</span>
        </div>
        <nav className={styles.mobileNav} aria-label="Mobile navigation">
          <Link className={isActive("/") ? styles.active : undefined} aria-current={isActive("/") ? "page" : undefined} href="/">Daily Log</Link>
          <Link className={isActive("/foods") ? styles.active : undefined} aria-current={isActive("/foods") ? "page" : undefined} href="/foods">Foods</Link>
          <Link className={isActive("/settings/targets") ? styles.active : undefined} aria-current={isActive("/settings/targets") ? "page" : undefined} href="/settings/targets">Targets</Link>
          <Link className={isActive("/settings/weight") ? styles.active : undefined} aria-current={isActive("/settings/weight") ? "page" : undefined} href="/settings/weight">Weight</Link>
        </nav>
      </header>
      <div className={styles.frame}>
        <aside className={styles.sidebar} aria-label="Primary navigation">
          <Link className={styles.wordmark} href="/">
            <Mark />
            <span>Daily Intake</span>
          </Link>
          <p className={styles.sidebarCaption}>A quiet record of what matters today.</p>
          <nav className={styles.nav}>
            <Link className={isActive("/") ? styles.active : undefined} aria-current={isActive("/") ? "page" : undefined} href="/">Daily Log</Link>
            <Link className={isActive("/foods") ? styles.active : undefined} aria-current={isActive("/foods") ? "page" : undefined} href="/foods">Food Database</Link>
            <div className={styles.navGroup}>
              <span>Settings</span>
              <Link className={isActive("/settings/targets") ? styles.active : undefined} aria-current={isActive("/settings/targets") ? "page" : undefined} href="/settings/targets">Targets</Link>
              <Link className={isActive("/settings/weight") ? styles.active : undefined} aria-current={isActive("/settings/weight") ? "page" : undefined} href="/settings/weight">Weight</Link>
            </div>
          </nav>
          <p className={styles.sidebarFoot}>Local only · no account required</p>
        </aside>
        <main className={styles.content}>{children}</main>
      </div>
    </div>
  );
}
