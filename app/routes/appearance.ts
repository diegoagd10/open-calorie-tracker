import { redirect } from "react-router";
import type { Route } from "./+types/appearance";
import { requireValidOrigin } from "../auth/http.server";

export async function action({ request }: Route.ActionArgs) {
  requireValidOrigin(request);
  const form = await request.formData();
  const theme = form.get("theme");
  if (theme !== "light" && theme !== "dark") {
    throw new Response("Choose Light or Dark.", { status: 400 });
  }
  let destination: URL;
  try {
    destination = new URL(String(form.get("returnTo") ?? "/settings/goals"), request.url);
  } catch {
    throw new Response("Invalid return location.", { status: 400 });
  }
  if (destination.origin !== new URL(request.url).origin) {
    throw new Response("Invalid return location.", { status: 400 });
  }
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return redirect(destination.pathname + destination.search + destination.hash, {
    headers: { "Set-Cookie": `appearance=${theme}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax${secure}` },
  });
}

export function loader() {
  return redirect("/settings/goals");
}
