import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";

import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import { z } from "zod";

import {
  CatalogManagementError,
  type CatalogManagement,
} from "../app/catalog-management/catalog-management.server";
import { localCatalogImportTokenMatches } from "../app/catalog-management/local-import-control.server";
import { getCatalogManagement } from "../app/catalog-management/runtime.server";

const requestSchema = z
  .object({
    archivePath: z.string().min(1).refine((value) => path.isAbsolute(value)),
    provider: z.literal("usda-fdc"),
  })
  .strict();
const statusSchema = z.object({
  jobId: z.uuid(),
  provider: z.literal("usda-fdc"),
});

export type LocalCatalogImportOptions = {
  controlToken: string;
  getManagement?: () => CatalogManagement;
};

export function isLoopbackAddress(address: string | undefined): boolean {
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    address === "::ffff:127.0.0.1"
  );
}

function authorized(request: Request, controlToken: string): boolean {
  return (
    isLoopbackAddress(request.socket.remoteAddress) &&
    localCatalogImportTokenMatches(
      controlToken,
      request.header("authorization"),
    )
  );
}

function hideLocalEndpoint(response: Response): void {
  response.status(404).type("text/plain").send("Not Found");
}

function requireLocalControlToken(controlToken: string) {
  return (request: Request, response: Response, next: NextFunction): void => {
    noStore(response);
    if (!authorized(request, controlToken)) {
      hideLocalEndpoint(response);
      return;
    }
    next();
  };
}

function noStore(response: Response): void {
  response.setHeader("Cache-Control", "no-store");
}

export function mountLocalCatalogImport(
  app: Express,
  options: LocalCatalogImportOptions,
): void {
  const managementFor = options.getManagement ?? getCatalogManagement;

  app.post(
    "/internal/catalog-imports",
    requireLocalControlToken(options.controlToken),
    express.json({ limit: "4kb", type: "application/json" }),
    async (request, response) => {
      const parsed = requestSchema.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({ error: "Invalid catalog import request." });
        return;
      }

      let archive: Awaited<ReturnType<typeof open>> | undefined;
      try {
        archive = await open(
          parsed.data.archivePath,
          constants.O_RDONLY | constants.O_NOFOLLOW,
        );
        const archiveStat = await archive.stat();
        if (!archiveStat.isFile() || archiveStat.size <= 0) {
          response.status(400).json({
            error: "Archive path must identify a non-empty regular file.",
          });
          return;
        }
        const stream = archive.createReadStream({ autoClose: true });
        archive = undefined;
        try {
          const jobId = await managementFor().submitArchive({
            filename: path.basename(parsed.data.archivePath),
            size: archiveStat.size,
            stream,
          });
          response.status(202).json({ jobId });
        } finally {
          stream.destroy();
        }
      } catch (error) {
        if (error instanceof CatalogManagementError) {
          response.status(409).json({ error: error.message });
          return;
        }
        const code = (error as NodeJS.ErrnoException).code;
        if (["EACCES", "ELOOP", "ENOENT", "ENOTDIR"].includes(code ?? "")) {
          response.status(400).json({
            error: "Archive path is not a readable regular file.",
          });
          return;
        }
        throw error;
      } finally {
        await archive?.close();
      }
    },
  );

  app.get(
    "/internal/catalog-imports/:provider/:jobId",
    requireLocalControlToken(options.controlToken),
    (request, response) => {
      const parsed = statusSchema.safeParse(request.params);
      if (!parsed.success) {
        response
          .status(400)
          .json({ error: "Invalid catalog import status request." });
        return;
      }
      const management = managementFor();
      const outcome = management
        .outcomes()
        .find((candidate) => candidate.jobId === parsed.data.jobId);
      const currentJob = management.read().job;
      const job = currentJob?.id === parsed.data.jobId ? currentJob : null;
      if (!outcome && !job) {
        response.status(404).json({ error: "Catalog import job was not found." });
        return;
      }
      response.json({ job, outcome: outcome ?? null });
    },
  );
}
