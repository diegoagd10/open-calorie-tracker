import { Form, Link } from "react-router";

import styles from "./food-log.module.css";

type AppNavigationProps = {
  active: "history" | "log" | "settings";
  csrfToken: string;
  selectedDate: string;
  today: string;
  username: string;
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
  username,
}: AppNavigationProps) {
  const historyHref = foodLogHref(selectedDate, selectedDate.slice(0, 7));

  return (
    <>
      <aside className={styles.desktopRail} aria-label="Primary navigation">
        <div className={styles.railBrand}>
          <span className={styles.brandMark} aria-hidden="true">
            OC
          </span>
          <span>
            <strong>Open Calory</strong>
            <small>Private tracker</small>
          </span>
        </div>
        <nav className={styles.railNav}>
          <Link
            aria-current={active === "log" ? "page" : undefined}
            to={foodLogHref(today)}
          >
            Today
          </Link>
          <Link
            aria-current={active === "history" ? "page" : undefined}
            to={historyHref}
          >
            History
          </Link>
          <Link
            aria-current={active === "settings" ? "page" : undefined}
            to="/settings/goals"
          >
            Settings
          </Link>
        </nav>
        <div className={styles.railFooter}>
          <Link className={styles.railAccount} to="/account/password">
            <strong>Change password</strong>
            <small>Signed in as {username}</small>
          </Link>
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
          <span aria-hidden="true">▤</span>
          Log
        </Link>
        <Link
          aria-current={active === "history" ? "page" : undefined}
          to={historyHref}
        >
          <span aria-hidden="true">□</span>
          History
        </Link>
        <Link
          aria-current={active === "settings" ? "page" : undefined}
          to="/settings/goals"
        >
          <span aria-hidden="true">⚙</span>
          Settings
        </Link>
      </nav>
    </>
  );
}
