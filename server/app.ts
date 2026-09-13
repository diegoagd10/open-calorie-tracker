import { routerHandler } from "./router";
import express from "express";

import { initializeApplicationDatabase } from "../app/database/runtime.server";
import { entryPolicy } from "./entry-policy";
import type { RequestEntry } from "../app/runtime.server";

import { shutdownApplicationDatabase } from "../app/database/runtime.server";
import { getPhotoAnalysisService, shutdownPhotoAnalysis } from "../app/photo-analysis/runtime.server";
import { getCatalogManagement, shutdownCatalogManagement } from "../app/catalog-management/runtime.server";
import { ensureLocalCatalogImportToken } from "../app/catalog-management/local-import-control.server";
import { mountLocalCatalogImport } from "./local-catalog-import";
export async function shutdown() { shutdownPhotoAnalysis(); await shutdownCatalogManagement(); shutdownApplicationDatabase(); }

initializeApplicationDatabase();
getCatalogManagement();
getPhotoAnalysisService();

export function createApplication(entry: RequestEntry, controlToken: string) {
  const app = express();
  app.set("trust proxy", false);
  mountLocalCatalogImport(app, { controlToken });
  app.use(entryPolicy(entry));
  app.use("/assets", express.static("build/client/assets", { immutable: true, maxAge: "1y" }));
  app.use(express.static("build/client", { maxAge: "1h" }));
  app.use(routerHandler(() => import("virtual:react-router/server-build")));
  return app;
}

const controlToken = await ensureLocalCatalogImportToken();
export function applicationForEntry(entry: RequestEntry) {
  return createApplication(entry, controlToken);
}
