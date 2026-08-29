import type { Route } from "./+types/home";
import { Form, Link, redirect } from "react-router";

import { getAuthenticatedSession } from "../auth/http.server";
import styles from "../readiness.module.css";

export function meta() {
  return [
    { title: "Open Calory Tracker · Private application" },
    {
      name: "description",
      content: "Your private Open Calory Tracker application space",
    },
  ];
}

export function headers() {
  return { "Cache-Control": "no-store" };
}

export async function loader({ request }: Route.LoaderArgs) {
  const session = await getAuthenticatedSession(request);

  if (!session) {
    return redirect("/login");
  }

  return { csrfToken: session.csrfToken, username: session.user.username };
}

export default function Home({ loaderData }: Route.ComponentProps) {
  return (
    <main className={styles.shell}>
      <section className={styles.panel} aria-labelledby="application-heading">
        <p className={styles.eyebrow}>Open Calory Tracker</p>
        <h1 className={styles.heading} id="application-heading">
          Your private application space
        </h1>
        <p className={styles.summary}>Signed in as {loaderData.username}</p>
        <Link className={styles.accountLink} to="/account/password">
          <span>
            <strong>Change password</strong>
            <small>Rotate this session and revoke every other phone.</small>
          </span>
          <span aria-hidden="true">›</span>
        </Link>
        <Form action="/logout" method="post">
          <input
            name="csrfToken"
            type="hidden"
            value={loaderData.csrfToken}
          />
          <button className={styles.logout} type="submit">
            Sign out
          </button>
        </Form>
      </section>
    </main>
  );
}
