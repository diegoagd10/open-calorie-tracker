import { createRequestHandler } from "@react-router/express";
import express from "express";

import { initializeApplicationDatabase } from "../app/database/runtime.server";
import { resolveClientIp } from "./client-ip";

import { shutdownApplicationDatabase } from "../app/database/runtime.server";
import { getPhotoAnalysisService, shutdownPhotoAnalysis } from "../app/photo-analysis/runtime.server";
import { getCatalogManagement, shutdownCatalogManagement } from "../app/catalog-management/runtime.server";
import { ensureLocalCatalogImportToken } from "../app/catalog-management/local-import-control.server";
import { mountLocalCatalogImport } from "./local-catalog-import";
export async function shutdown() { shutdownPhotoAnalysis(); await shutdownCatalogManagement(); shutdownApplicationDatabase(); }

initializeApplicationDatabase();
getCatalogManagement();
getPhotoAnalysisService();

export const app = express();

if (process.env.TRUST_PROXY) {
  app.set("trust proxy", process.env.TRUST_PROXY);
}

mountLocalCatalogImport(app, {
  controlToken: await ensureLocalCatalogImportToken(),
});

app.use((request, _response, next) => {
  const testClientIp =
    process.env.NODE_ENV === "test"
      ? request.header("X-Test-Client-IP")
      : undefined;

  request.headers["x-open-calory-client-ip"] = resolveClientIp({
    nodeEnvironment: process.env.NODE_ENV,
    proxyClientIp: request.ip,
    remoteAddress: request.socket.remoteAddress,
    testClientIp,
  });
  next();
});

app.use(
  createRequestHandler({
    build: () => import("virtual:react-router/server-build"),
  }),
);
