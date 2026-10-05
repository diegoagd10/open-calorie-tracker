import packageJson from "../../package.json" with { type: "json" };
import type { ApplicationDatabaseClient } from "../database/database.server";
import { getApplicationDatabase } from "../database/runtime.server";
import { BarcodeRepository } from "./barcode.repository.server";
import { BarcodeService } from "./barcode.server";

let barcodeService: { database: ApplicationDatabaseClient; service: BarcodeService } | undefined;

/** Resolves `fetch` per request, so a preloaded or test replacement of the global is honored. */
const globalFetch: typeof fetch = (input, init) => globalThis.fetch(input, init);

/** A barcode service over `database`, for callers that already hold a client. */
export function createBarcodeService(
  database: ApplicationDatabaseClient,
  fetcher: typeof fetch = globalFetch,
): BarcodeService {
  return new BarcodeService(new BarcodeRepository(database), fetcher, packageJson.version);
}

export function getBarcodeService(): BarcodeService {
  const database = getApplicationDatabase().getClient();
  if (barcodeService?.database !== database) {
    barcodeService = { database, service: createBarcodeService(database) };
  }
  return barcodeService.service;
}
