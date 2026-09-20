import { Form, useLocation, useNavigation, useRouteLoaderData } from "react-router";
import type { loader } from "../root";
import styles from "./selector.module.css";

export function AppearanceSelector() {
  const root = useRouteLoaderData<typeof loader>("root");
  const location = useLocation();
  const navigation = useNavigation();
  const theme = root?.theme ?? "dark";
  return (
    <section className={styles.card} aria-labelledby="appearance-heading">
      <h2 id="appearance-heading">Appearance</h2>
      <p>Choose the theme for this browser. Your preference is saved automatically.</p>
      <Form action="/appearance" method="post">
        <input type="hidden" name="returnTo" value={location.pathname + location.search} />
        <div className={styles.options} role="group" aria-label="Color theme">
          {(["light", "dark"] as const).map(option => (
            <button key={option} name="theme" value={option} aria-pressed={theme === option} disabled={navigation.state !== "idle"}>
              {option === "light" ? "Light" : "Dark"}
            </button>
          ))}
        </div>
      </Form>
    </section>
  );
}
