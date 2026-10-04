import type { ReactNode } from "react";
import { Form, Link } from "react-router";

import { AppNavigation } from "./app-navigation";
import shellStyles from "./food-log.module.css";

import styles from "./goals.module.css";
import { UiIcon } from "./ui-icon";

export type SettingsDestinationsProps = {
  active: SettingsSection;
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
            <span className={styles.accountAccessIcon}>
              <UiIcon name="goals" />
            </span>
            <span>
              <strong>Daily Goal</strong>
              <small>Set the targets every Food Log day is measured against.</small>
            </span>
            <span aria-hidden="true">›</span>
          </Link>
        ) : null}
        {isAdministrator && active !== "catalogs" ? (
          <Link className={styles.accountAccessRow} to="/settings/catalogs">
            <span className={styles.accountAccessIcon}>
              <UiIcon name="database" />
            </span>
            <span><strong>Food Catalogs</strong><small>View installed catalogs and check for updates.</small></span>
            <span aria-hidden="true">›</span>
          </Link>
        ) : null}
        {isAdministrator && active !== "ai" ? (
          <Link className={styles.accountAccessRow} to="/settings/ai">
            <span className={styles.accountAccessIcon}>
              <UiIcon name="sparkle" />
            </span>
            <span>
              <strong>AI photo estimates</strong>
              <small>Connect your account to estimate calories from photos.</small>
            </span>
            <span aria-hidden="true">›</span>
          </Link>
        ) : null}
        {isAdministrator && active !== "users" ? (
          <Link className={styles.accountAccessRow} to="/settings/users">
            <span className={styles.accountAccessIcon}>
              <UiIcon name="users" />
            </span>
            <span>
              <strong>Users</strong>
              <small>View member accounts and their access state.</small>
            </span>
            <span aria-hidden="true">›</span>
          </Link>
        ) : null}
        {active !== "security" ? (
          <Link className={styles.accountAccessRow} to="/settings/security">
            <span className={styles.accountAccessIcon}>
              <UiIcon name="key" />
            </span>
            <span>
              <strong>Account security</strong>
              <small>Manage your password and key sign-in.</small>
            </span>
            <span aria-hidden="true">›</span>
          </Link>
        ) : null}
        {active !== "api-keys" ? (
          <Link className={styles.accountAccessRow} to="/settings/api-keys">
            <span className={styles.accountAccessIcon}>
              <UiIcon name="key" />
            </span>
            <span><strong>API keys</strong><small>Let apps and AI assistants read your Food Log.</small></span>
            <span aria-hidden="true">›</span>
          </Link>
        ) : null}
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

export type SettingsSection = "goals" | "security" | "api-keys" | "users" | "ai" | "catalogs";

const personalSections = [
  { icon: "goals", key: "goals", label: "Daily Goal", to: "/settings/goals" },
  { icon: "key", key: "security", label: "Account security", to: "/settings/security" },
  { icon: "key", key: "api-keys", label: "API keys", to: "/settings/api-keys" },
] as const;

const administratorSections = [
  { icon: "users", key: "users", label: "Users", to: "/settings/users" },
  { icon: "sparkle", key: "ai", label: "AI photo estimates", to: "/settings/ai" },
  { icon: "database", key: "catalogs", label: "Food Catalogs", to: "/settings/catalogs" },
] as const;

/** Desktop-only column listing every settings section; phones keep the in-page list. */
function SettingsSideNav({
  active,
  isAdministrator,
}: {
  active: SettingsSection;
  isAdministrator: boolean;
}) {
  const link = (
    section: (typeof personalSections)[number] | (typeof administratorSections)[number],
  ) => (
    <li key={section.key}>
      <Link aria-current={section.key === active ? "page" : undefined} to={section.to}>
        <UiIcon name={section.icon} />
        <span>{section.label}</span>
      </Link>
    </li>
  );
  return (
    <nav aria-label="Settings sections" className={styles.settingsSideNav}>
      <p className={styles.settingsSideTitle}>Settings</p>
      <ul>{personalSections.map(link)}</ul>
      {isAdministrator ? (
        <>
          <p className={styles.settingsSideGroup}>Administration</p>
          <ul>{administratorSections.map(link)}</ul>
        </>
      ) : null}
    </nav>
  );
}

/** The page frame every settings route shares: skip link, app rail, and section column. */
export function SettingsShell({
  active,
  children,
  csrfToken,
  isAdministrator,
  skipLabel,
  skipTarget,
  today,
}: {
  active: SettingsSection;
  children: ReactNode;
  csrfToken: string;
  isAdministrator: boolean;
  skipLabel: string;
  skipTarget: string;
  today: string;
}) {
  return (
    <div className={`${shellStyles.shell} ${shellStyles.settingsShell}`}>
      <a className={shellStyles.skipLink} href={`#${skipTarget}`}>
        {skipLabel}
      </a>
      <AppNavigation
        active="settings"
        csrfToken={csrfToken}
        selectedDate={today}
        today={today}
      />
      <SettingsSideNav active={active} isAdministrator={isAdministrator} />
      {children}
    </div>
  );
}
