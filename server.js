import { randomUUID } from "node:crypto";
import { isIP } from "node:net";

import compression from "compression";
import express from "express";

import {
  operationalError,
  operationalLog,
} from "./server/operational-logging.js";

const BUILD_PATH = "./build/server/index.js";
const DEVELOPMENT = process.env.NODE_ENV === "development";

function requestIdFor(request) {
  const supplied = request.get("x-request-id");
  return supplied && /^[A-Za-z0-9._:-]{1,128}$/.test(supplied)
    ? supplied
    : randomUUID();
}

function privateDockerNetworkCidr(value) {
  const match = /^([^/]+)\/(\d{1,2})$/.exec(value.trim());
  if (!match || isIP(match[1]) !== 4) return false;
  const prefix = Number(match[2]);
  if (!Number.isInteger(prefix) || prefix < 16 || prefix > 32) return false;
  const octets = match[1].split(".").map(Number);
  return (
    octets[0] === 10 ||
    (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
    (octets[0] === 192 && octets[1] === 168)
  );
}

async function startServer() {
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
    if (process.env.NODE_ENV === "production" && canonicalUrl.protocol !== "https:") {
      throw new Error("APPLICATION_URL must use HTTPS in production");
    }
    if (process.env.NODE_ENV === "production") {
      const applicationHost = process.env.APPLICATION_HOST?.trim().toLowerCase();
      if (!applicationHost || applicationHost !== canonicalUrl.hostname) {
        throw new Error(
          "APPLICATION_HOST must exactly match the canonical APPLICATION_URL hostname",
        );
      }
      const trustProxy = process.env.TRUST_PROXY;
      if (!trustProxy || !privateDockerNetworkCidr(trustProxy)) {
        throw new Error(
          "TRUST_PROXY must be one private IPv4 Docker network CIDR with a prefix from 16 through 32",
        );
      }
    }
  }

  const app = express();
  let shutdownApplication = () => {};

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

  app.use((error, _request, response, next) => {
    operationalLog("error", "request_failed", {
      requestId: response.locals.requestId,
      error: operationalError(error, false),
    });
    if (response.headersSent) return next(error);
    return response.status(500).json({ status: "internal_error" });
  });

  const server = app.listen(port, "0.0.0.0", () => {
    operationalLog("info", "server_started", {
      port,
      environment: DEVELOPMENT ? "development" : process.env.NODE_ENV,
    });
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      server.close(() => {
        shutdownApplication();
        operationalLog("info", "server_stopped", { signal });
        process.exit(0);
      });
    });
  }
}

startServer().catch((error) => {
  operationalLog("error", "startup_failed", {
    error: operationalError(error),
  });
  process.exitCode = 1;
});
