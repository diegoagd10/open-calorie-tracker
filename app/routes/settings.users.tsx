import { AppNavigation } from "../app-navigation";
import type { Route } from "./+types/settings.users";
import { requireAdministratorSession } from "../auth/http.server";
import { getAuthenticationService } from "../auth/runtime.server";
import { formatLocalDate } from "../food-log/date";
import shellStyles from "../food-log.module.css";
import { SettingsDestinations } from "../settings-destinations";
import styles from "../users.module.css";

export function meta() {
  return [
    { title: "Users · Open Calory Tracker" },
    {
      name: "description",
      content: "Manage member access without exposing private nutrition data",
    },
  ];
}

export function headers() {
  return { "Cache-Control": "no-store" };
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await requireAdministratorSession(request);
  return {
    csrfToken: session.csrfToken,
    members: getAuthenticationService().listManageableMembers(),
    today: new Date().toISOString().slice(0, 10),
    username: session.user.username,
  };
}

export default function Users({ loaderData }: Route.ComponentProps) {
  return (
    <div className={shellStyles.shell}>
      <a className={shellStyles.skipLink} href="#member-directory-content">
        Skip to member directory
      </a>
      <AppNavigation
        active="settings"
        csrfToken={loaderData.csrfToken}
        selectedDate={loaderData.today}
        today={loaderData.today}
        username={loaderData.username}
      />
      <main className={shellStyles.appSurface} id="member-directory-content">
        <header className={shellStyles.mobileHeader}>
          <div className={shellStyles.titleLine}>
            <h1>Users</h1>
            <span className={shellStyles.privacyCue}>◈ Accounts only</span>
          </div>
          <p className={shellStyles.selectedDateLabel}>
            Manage account access without opening private nutrition data.
          </p>
        </header>

        <SettingsDestinations
          active="users"
          csrfToken={loaderData.csrfToken}
          isAdministrator
        />

        <section className={styles.directory} aria-labelledby="members-heading">
          <div className={styles.directoryHeading}>
            <div>
              <h2 id="members-heading">Members</h2>
              <p>Normalized account names in alphabetical order.</p>
            </div>
            <strong>{loaderData.members.length}</strong>
          </div>
          {loaderData.members.length === 0 ? (
            <p className={styles.empty}>No member accounts yet.</p>
          ) : (
            <ul className={styles.memberList}>
              {loaderData.members.map((member) => (
                <li key={member.username}>
                  <span>
                    <strong>{member.username}</strong>
                    <small>
                      Created {formatLocalDate(member.createdAt.slice(0, 10), {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}
                    </small>
                  </span>
                  <span
                    className={
                      member.accessState === "active"
                        ? styles.activeState
                        : styles.disabledState
                    }
                  >
                    {member.accessState === "active" ? "Active" : "Disabled"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
      <aside
        className={shellStyles.desktopContext}
        aria-label="Member directory privacy"
      >
        <div className={shellStyles.contextCard}>
          <span>Visible here</span>
          <strong>Account metadata</strong>
          <span>Kept private</span>
          <strong>Nutrition data</strong>
          <small>The administrator account is not listed.</small>
        </div>
      </aside>
    </div>
  );
}
