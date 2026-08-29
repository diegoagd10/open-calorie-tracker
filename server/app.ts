import { createRequestHandler } from "@react-router/express";
import express from "express";

import { initializeApplicationDatabase } from "../app/database/runtime.server";

export { shutdownApplicationDatabase as shutdown } from "../app/database/runtime.server";

initializeApplicationDatabase();

export const app = express();

app.use(
  createRequestHandler({
    build: () => import("virtual:react-router/server-build"),
  }),
);
