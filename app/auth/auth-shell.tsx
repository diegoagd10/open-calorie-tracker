import type { ReactNode } from "react";
import { Link } from "react-router";

import styles from "../auth.module.css";

export type AuthShellProps = {
  activePage: "login" | "register";
  children: ReactNode;
};

export function AuthShell({ activePage, children }: AuthShellProps) {
  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="auth-title">
        <header className={styles.header}>
          <h1 className={styles.heading} id="auth-title">
            Private account access
          </h1>
          <span className={styles.privacyCue}>No email required</span>
        </header>

        <nav className={styles.tabs} aria-label="Account access">
          <Link
            aria-current={activePage === "login" ? "page" : undefined}
            className={`${styles.tab} ${
              activePage === "login" ? styles.activeTab : ""
            }`}
            to="/login"
          >
            Sign in
          </Link>
          <Link
            aria-current={activePage === "register" ? "page" : undefined}
            className={`${styles.tab} ${
              activePage === "register" ? styles.activeTab : ""
            }`}
            to="/register"
          >
            Register
          </Link>
        </nav>

        {children}
      </section>
    </main>
  );
}
