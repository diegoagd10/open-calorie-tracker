import type { ReactNode } from "react";

import styles from "../auth.module.css";

export type AuthShellProps = {
  children: ReactNode;
};

export function AuthShell({ children }: AuthShellProps) {
  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="auth-title">
        <header className={styles.header}>
          <h1 className={styles.heading} id="auth-title">
            Private account access
          </h1>
          <span className={styles.privacyCue}>No email required</span>
        </header>

        {children}
      </section>
    </main>
  );
}
