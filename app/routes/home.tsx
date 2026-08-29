import type { Route } from "./+types/home";
import { isDatabaseReady } from "../database/database.server";
import { getApplicationDatabase } from "../database/runtime.server";
import styles from "../readiness.module.css";

export function meta({ loaderData }: Route.MetaArgs) {
  const readiness = loaderData?.ready ? "Ready" : "Not ready";

  return [
    { title: `Open Calory Tracker · ${readiness}` },
    {
      name: "description",
      content: "Open Calory Tracker deployment readiness",
    },
  ];
}

export function loader() {
  const status = getApplicationDatabase().getStatus();

  return {
    migrationsReady:
      status.appliedMigrations >= 1 && status.schemaVersion === "1",
    ready: isDatabaseReady(status),
    storageWritable: status.writable,
  };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const heading = loaderData.ready
    ? "Open Calory Tracker is ready"
    : "Open Calory Tracker is not ready";
  const summary = loaderData.ready
    ? "All core systems are operational."
    : "One or more core systems are unavailable.";

  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="readiness-heading">
        <p className={styles.eyebrow}>Open Calory Tracker</p>
        <h1 className={styles.heading} id="readiness-heading">
          {heading}
        </h1>
        <p className={styles.summary}>{summary}</p>

        <dl className={styles.checks} aria-label="System readiness">
          <div className={styles.check}>
            <dt>Server rendering</dt>
            <dd className={styles.ready}>Ready</dd>
          </div>
          <div className={styles.check}>
            <dt>Database migrations</dt>
            <dd
              className={
                loaderData.migrationsReady ? styles.ready : styles.unavailable
              }
            >
              {loaderData.migrationsReady ? "Ready" : "Unavailable"}
            </dd>
          </div>
          <div className={styles.check}>
            <dt>SQLite storage</dt>
            <dd
              className={
                loaderData.storageWritable ? styles.ready : styles.unavailable
              }
            >
              {loaderData.storageWritable ? "Writable" : "Unavailable"}
            </dd>
          </div>
        </dl>
      </section>
    </main>
  );
}
