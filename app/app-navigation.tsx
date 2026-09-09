import { Form, Link, useRouteLoaderData } from "react-router";

import type { loader as rootLoader } from "./root";
import { CatalogNotifications } from "./catalog-management/notifications";

import styles from "./food-log.module.css";
import { UiIcon } from "./ui-icon";

export type AppNavigationProps = {
  active: "history" | "log" | "settings";
  csrfToken: string;
  selectedDate: string;
  today: string;
};

function foodLogHref(date: string, calendar?: string): string {
  const parameters = new URLSearchParams({ date });
  if (calendar) parameters.set("calendar", calendar);
  return `/?${parameters}`;
}

export function AppNavigation({
  active,
  csrfToken,
  selectedDate,
  today,
}: AppNavigationProps) {
  const root = useRouteLoaderData<typeof rootLoader>("root");
  const historyHref = foodLogHref(selectedDate, selectedDate.slice(0, 7));

  return (
    <>
      <aside className={styles.desktopRail} aria-label="Primary navigation">
        <div className={styles.railBrand}>
          <span className={styles.brandMark} aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>
            <strong>Open Calorie</strong>
            <small>Private tracker</small>
          </span>
        </div>
        <nav className={styles.railNav}>
          <Link
            aria-current={active === "log" ? "page" : undefined}
            to={foodLogHref(today)}
          >
            <UiIcon name="log" />
            <span>Today</span>
          </Link>
          <Link
            aria-current={active === "history" ? "page" : undefined}
            to={historyHref}
          >
            <UiIcon name="calendar" />
            <span>History</span>
          </Link>
          <Link
            aria-current={active === "settings" ? "page" : undefined}
            to="/settings/goals"
          >
            <UiIcon name="settings" />
            <span>Settings</span>
          </Link>
        </nav>
        <div className={styles.railFooter}>
          <div className={styles.railPrivacy}>
            <UiIcon name="lock" />
            <div>
              <strong>Private by default</strong>
              <p>Your Food Log is isolated to this account.</p>
            </div>
          </div>
          <Form action="/logout" method="post">
            <input name="csrfToken" type="hidden" value={csrfToken} />
            <button className={styles.logout} type="submit">
              Sign out
            </button>
          </Form>
        </div>
      </aside>
      <nav className={styles.mobileNav} aria-label="Primary navigation">
        <Link
          aria-current={active === "log" ? "page" : undefined}
          to={foodLogHref(today)}
        >
          <UiIcon name="log" />
          Log
        </Link>
        <Link
          aria-current={active === "history" ? "page" : undefined}
          to={historyHref}
        >
          <UiIcon name="calendar" />
          History
        </Link>
        <Link
          aria-current={active === "settings" ? "page" : undefined}
          to="/settings/goals"
        >
          <UiIcon name="settings" />
          Settings
        </Link>
      </nav>
      {root?.catalogAdministrator ? <CatalogNotifications /> : null}
    </>
  );
}
