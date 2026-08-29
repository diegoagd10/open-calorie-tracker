import { randomUUID } from "node:crypto";

import compression from "compression";
import express from "express";

const BUILD_PATH = "./build/server/index.js";
const DEVELOPMENT = process.env.NODE_ENV === "development";
const port = Number.parseInt(process.env.PORT ?? "3000", 10);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer from 1 through 65535");
}

if (!DEVELOPMENT) {
  const applicationUrl = process.env.APPLICATION_URL;
  if (!applicationUrl) {
    throw new Error("APPLICATION_URL is required outside development");
  }

  const canonicalUrl = new URL(applicationUrl);
  if (
    canonicalUrl.username ||
    canonicalUrl.password ||
    canonicalUrl.pathname !== "/" ||
    canonicalUrl.search ||
    canonicalUrl.hash
  ) {
    throw new Error(
      "APPLICATION_URL must be an origin without credentials, path, query, or hash",
    );
  }
}

const app = express();
let shutdownApplication = () => {};

app.disable("x-powered-by");
app.use(compression());
app.use((request, response, next) => {
  const requestId = request.get("x-request-id") ?? randomUUID();
  const startedAt = performance.now();

  response.setHeader("x-request-id", requestId);
  response.on("finish", () => {
    console.log(
      JSON.stringify({
        level: "info",
        event: "request_completed",
        requestId,
        method: request.method,
        path: request.path,
        status: response.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
      }),
    );
  });
  next();
});

if (DEVELOPMENT) {
  const viteDevelopmentServer = await import("vite").then((vite) =>
    vite.createServer({ server: { middlewareMode: true } }),
  );
  const databaseRuntime = await viteDevelopmentServer.ssrLoadModule(
    "./app/database/runtime.server.ts",
  );

  databaseRuntime.initializeApplicationDatabase();
  shutdownApplication = databaseRuntime.shutdownApplicationDatabase;
  app.use(viteDevelopmentServer.middlewares);
  app.use(async (request, response, next) => {
    try {
      const source = await viteDevelopmentServer.ssrLoadModule("./server/app.ts");
      return await source.app(request, response, next);
    } catch (error) {
      if (error instanceof Error) {
        viteDevelopmentServer.ssrFixStacktrace(error);
      }
      next(error);
    }
  });
} else {
  app.use(
    "/assets",
    express.static("build/client/assets", { immutable: true, maxAge: "1y" }),
  );
  app.use(express.static("build/client", { maxAge: "1h" }));

  const production = await import(BUILD_PATH);
  shutdownApplication = production.shutdown;
  app.use(production.app);
}

const server = app.listen(port, "0.0.0.0", () => {
  console.log(
    JSON.stringify({
      level: "info",
      event: "server_started",
      port,
      environment: DEVELOPMENT ? "development" : "production",
    }),
  );
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    server.close(() => {
      shutdownApplication();
      process.exit(0);
    });
  });
}
