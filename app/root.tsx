import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  isRouteErrorResponse,
} from "react-router";

import stylesheet from "./styles.css?url";
import readinessStyles from "./readiness.module.css";

export const links = () => [
  { rel: "stylesheet", href: stylesheet },
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "manifest", href: "/manifest.webmanifest" },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#102a43" />
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
  return <Outlet />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  let heading = "Something went wrong";
  let message = "The application could not complete this request.";

  if (isRouteErrorResponse(error)) {
    heading = error.status === 404 ? "Page not found" : heading;
    message = error.status === 404 ? "This page does not exist." : message;
  }

  return (
    <main className={readinessStyles.shell}>
      <section
        className={readinessStyles.panel}
        aria-labelledby="error-heading"
      >
        <p className={readinessStyles.eyebrow}>Open Calory Tracker</p>
        <h1 className={readinessStyles.heading} id="error-heading">
          {heading}
        </h1>
        <p>{message}</p>
      </section>
    </main>
  );
}
