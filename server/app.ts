import { createRequestHandler } from "@react-router/express";
import express from "express";

import { initializeApplicationDatabase } from "../app/database/runtime.server";

export { shutdownApplicationDatabase as shutdown } from "../app/database/runtime.server";

initializeApplicationDatabase();

export const app = express();

if (process.env.TRUST_PROXY) {
  app.set("trust proxy", process.env.TRUST_PROXY);
}

app.use((request, _response, next) => {
  const testClientIp =
    process.env.NODE_ENV === "test"
      ? request.header("X-Test-Client-IP")
      : undefined;

  request.headers["x-open-calory-client-ip"] =
    testClientIp ?? request.ip ?? request.socket.remoteAddress ?? "unknown";
  next();
});

app.use(
  createRequestHandler({
    build: () => import("virtual:react-router/server-build"),
  }),
);
