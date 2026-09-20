import { expect, test, vi, afterEach } from "vitest";
import { readTheme } from "../app/appearance/theme";
import { action, loader } from "../app/routes/appearance";
import type { Route } from "../app/routes/+types/appearance";

const origin = "http://localhost:3000";
afterEach(() => vi.unstubAllEnvs());
function submit(theme: string, returnTo = "/settings/goals?effectiveDate=2026-09-18", requestOrigin = origin) {
  vi.stubEnv("APPLICATION_URL", origin);
  const request = new Request(origin + "/appearance", { method: "POST", headers: { Origin: requestOrigin }, body: new URLSearchParams({ theme, returnTo }) });
  return action({ request } as Route.ActionArgs);
}

test("theme defaults safely and only accepts the preference cookie", () => {
  expect(readTheme(null)).toBe("dark");
  expect(readTheme("session=light; appearance=light")).toBe("light");
  expect(readTheme("appearance=dark")).toBe("dark");
  expect(readTheme("appearance=<script>")).toBe("dark");
  expect(readTheme("otherappearance=light")).toBe("dark");
});
test.each(["light", "dark"])("saves %s for a year and returns to the same screen", async theme => {
  const response = await submit(theme);
  expect(response.status).toBe(302);
  expect(response.headers.get("Location")).toBe("/settings/goals?effectiveDate=2026-09-18");
  const cookie = response.headers.get("Set-Cookie");
  expect(cookie).toContain(`appearance=${theme}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`);
  expect(readTheme(cookie)).toBe(theme);
});
test("rejects invalid themes, foreign origins and external return locations", async () => {
  await expect(submit("system")).rejects.toMatchObject({ status: 400 });
  await expect(submit("light", "https://evil.example/")).rejects.toMatchObject({ status: 400 });
  await expect(submit("light", "http://[")).rejects.toMatchObject({ status: 400 });
  await expect(submit("light", "/", "https://evil.example")).rejects.toMatchObject({ status: 403 });
});
test("appearance resource GET returns to settings", () => {
  expect(loader().headers.get("Location")).toBe("/settings/goals");
});

test("HTTPS preferences are secure and a missing return location uses settings", async () => {
  vi.stubEnv("APPLICATION_URL", "https://localhost:3000");
  const request = new Request("https://localhost:3000/appearance", { method: "POST", headers: { Origin: "https://localhost:3000" }, body: new URLSearchParams({ theme: "light" }) });
  const response = await action({ request } as Route.ActionArgs);
  expect(response.headers.get("Set-Cookie")).toContain("; Secure");
  expect(response.headers.get("Location")).toBe("/settings/goals");
});
