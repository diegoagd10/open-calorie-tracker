import { randomUUID } from "node:crypto";

import compression from "compression";
import express from "express";

import {
  operationalError,
  operationalLog,
} from "./operational-logging.js";

const BUILD_PATH = "../build/server/index.js";

function requestIdFor(request) {
  const supplied = request.get("x-request-id");
  return supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied)
    ? supplied
    : randomUUID();
}

export function createHttpApplication() {
  const app = express();
  app.disable("x-powered-by");
  app.use(compression());
  app.use((request, response, next) => {
    const requestId = requestIdFor(request);
    const startedAt = performance.now();

    response.locals.requestId = requestId;
    request.headers["x-open-calory-request-id"] = requestId;
    response.setHeader("x-request-id", requestId);
    response.on("finish", () => {
      operationalLog("info", "request_completed", {
        requestId,
        method: request.method,
        path: request.path,
        status: response.statusCode,
        durationMs: Math.round(performance.now() - startedAt),
      });
    });
    next();
  });
  return app;
}

export async function mountProductionApplication(app, entry = "tunnel") {
  const production = await import(BUILD_PATH);
  app.use(production.applicationForEntry(entry));
  return production.shutdown;
}

export function mountOperationalErrorHandler(app) {
  app.use((error, _request, response, next) => {
    operationalLog("error", "request_failed", {
      requestId: response.locals.requestId,
      error: operationalError(error, false),
    });
    if (response.headersSent) return next(error);
    return response.status(500).json({ status: "internal_error" });
  });
}

export function closeOnProcessSignals(server, shutdownApplication) {
  const servers = Array.isArray(server) ? server : [server];
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      Promise.all(servers.map((listener) => new Promise((resolve, reject) => {
        listener.close((error) => error ? reject(error) : resolve());
        listener.closeIdleConnections();
      }))).then(async () => {
        try {
          await shutdownApplication();
          operationalLog("info", "server_stopped", { signal });
          process.exit(0);
        } catch (error) {
          operationalLog("error", "shutdown_failed", { error: operationalError(error) });
          process.exit(1);
        }
      }).catch((error) => {
        operationalLog("error", "shutdown_failed", { error: operationalError(error) });
        process.exit(1);
      });
    });
  }
}
