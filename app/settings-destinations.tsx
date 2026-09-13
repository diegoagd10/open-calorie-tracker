import { Form, Link } from "react-router";

import styles from "./goals.module.css";

export type SettingsDestinationsProps = {
  active: "goals" | "users" | "ai" | "catalogs";
  csrfToken: string;
  isAdministrator: boolean;
};

export function SettingsDestinations({
  active,
  csrfToken,
  isAdministrator,
}: SettingsDestinationsProps) {
  return (
    <>
      <nav className={styles.settingsDestinations} aria-label="Settings">
        {active !== "goals" ? (
          <Link className={styles.accountAccessRow} to="/settings/goals">
            <span className={styles.accountAccessIcon} aria-hidden="true">
              ◇
            </span>
            <span>
              <strong>Display and goals</strong>
              <small>Manage units and effective-dated nutrition goals.</small>
            </span>
            <span aria-hidden="true">›</span>
          </Link>
        ) : null}
        {isAdministrator && active !== "catalogs" ? (
          <Link className={styles.accountAccessRow} to="/settings/catalogs">
            <span className={styles.accountAccessIcon} aria-hidden="true">▤</span>
            <span><strong>Food Catalogs</strong><small>Install USDA foods for local search and logging.</small></span>
            <span aria-hidden="true">›</span>
          </Link>
        ) : null}
        {isAdministrator && active !== "ai" ? (
          <Link className={styles.accountAccessRow} to="/settings/ai">
            <span className={styles.accountAccessIcon} aria-hidden="true">✧</span>
            <span>
              <strong>AI photo estimates</strong>
              <small>Connect your account to estimate calories from photos.</small>
            </span>
            <span aria-hidden="true">›</span>
          </Link>
        ) : null}
        {isAdministrator && active !== "users" ? (
          <Link className={styles.accountAccessRow} to="/settings/users">
            <span className={styles.accountAccessIcon} aria-hidden="true">
              ◎
            </span>
            <span>
              <strong>Users</strong>
              <small>View member accounts and their access state.</small>
            </span>
            <span aria-hidden="true">›</span>
          </Link>
        ) : null}
        <Link className={styles.accountAccessRow} to="/settings/security">
          <span className={styles.accountAccessIcon} aria-hidden="true">
            ◇
          </span>
          <span>
            <strong>Account security</strong>
            <small>Manage your password and key sign-in.</small>
          </span>
          <span aria-hidden="true">›</span>
        </Link>
      </nav>

      <Form action="/logout" className={styles.mobileSignOutForm} method="post">
        <input name="csrfToken" type="hidden" value={csrfToken} />
        <button aria-label="Sign out" type="submit">
          <span>
            <strong>Sign out this session</strong>
            <small>Other phones remain signed in.</small>
          </span>
          <span aria-hidden="true">›</span>
        </button>
      </Form>
    </>
  );
}
