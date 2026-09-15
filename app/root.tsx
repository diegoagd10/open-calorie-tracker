import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
  useRouteLoaderData,
} from "react-router";

import type { Route } from "./+types/root";
import { getSessionForAccountAccess } from "./auth/http.server";
import { CatalogNotifications } from "./catalog-management/notifications";

import stylesheet from "./styles.css?url";
import readinessStyles from "./readiness.module.css";

export async function loader({ request }: Route.LoaderArgs) {
  const session = await getSessionForAccountAccess(request);
  const navigation = { catalogNotifications: session && !session.user.passwordChangeRequired ? { viewerId: session.user.id } : null };
  return navigation;
}
export function headers() { return { "Cache-Control": "no-store" }; }

export const links = () => [
  { rel: "stylesheet", href: stylesheet },
  { rel: "icon", href: "/favicon.png", sizes: "64x64", type: "image/png" },
  {
    rel: "apple-touch-icon",
    href: "/apple-touch-icon.png",
    sizes: "180x180",
  },
  { rel: "manifest", href: "/manifest.webmanifest" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#102a43" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="mobile-web-app-capable" content="yes" />
        <meta
          name="apple-mobile-web-app-title"
          content="Open Calorie Tracker"
        />
        <meta name="apple-mobile-web-app-status-bar-style" content="default" />
        <meta name="format-detection" content="telephone=no" />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  const root = useRouteLoaderData<typeof loader>("root");
  return <>
    <Outlet />
    {root?.catalogNotifications ? <CatalogNotifications viewerId={root.catalogNotifications.viewerId} /> : null}
  </>;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  let heading = "Something went wrong";
  let message = "The application could not complete this request.";

  if (isRouteErrorResponse(error)) {
    heading = error.status === 404 ? "Page not found" : heading;
    message = error.status === 404 ? "This page does not exist." : message;
  }

  return (
    <>
      <title>{`${heading} · Open Calorie Tracker`}</title>
      <main className={readinessStyles.shell}>
        <section
          className={readinessStyles.panel}
          aria-labelledby="error-heading"
        >
          <p className={readinessStyles.eyebrow}>Open Calorie Tracker</p>
          <h1 className={readinessStyles.heading} id="error-heading">
            {heading}
          </h1>
          <p>{message}</p>
        </section>
      </main>
    </>
  );
}
