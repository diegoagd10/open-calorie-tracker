import { lstat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  type CatalogImportJob,
  type CatalogManagementOptions,
  type CatalogOutcome,
} from "../app/catalog-management/catalog-management.server";
import { readLocalCatalogImportToken } from "../app/catalog-management/local-import-control.server";
import { localCatalogImportBaseUrl } from "../app/catalog-management/runtime.server";

type CatalogStatus = {
  job: CatalogImportJob | null;
  outcome: CatalogOutcome | null;
};
type CatalogProviderId = NonNullable<CatalogManagementOptions["provider"]>;

export type CatalogImportCommandOptions = {
  baseUrl?: string;
  controlToken?: string;
  fetch?: typeof fetch;
  pollIntervalMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
  writeStandardError?: (value: string) => void;
  writeStandardOutput?: (value: string) => void;
};

const labels: Record<CatalogProviderId, string> = {
  "open-food-facts": "Open Food Facts",
  "usda-fdc": "USDA Foundation",
};

function usage(): string {
  return [
    "Usage:",
    "  pnpm catalog:import:usda -- /absolute/path/to/foundation.zip",
    "  pnpm catalog:import:off -- /absolute/path/to/openfoodfacts-products.jsonl.gz",
  ].join("\n");
}

function parseArguments(arguments_: string[]): {
  archivePath: string;
  provider: CatalogProviderId;
} {
  const normalized =
    arguments_[1] === "--"
      ? [arguments_[0], ...arguments_.slice(2)]
      : arguments_;
  const [provider, archivePath, ...extra] = normalized;
  if (
    (provider !== "usda-fdc" && provider !== "open-food-facts") ||
    !archivePath ||
    extra.length > 0
  ) {
    throw new Error(usage());
  }
  return { archivePath: path.resolve(archivePath), provider };
}

async function responseJson<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => ({}))) as {
    error?: unknown;
  };
  if (!response.ok) {
    throw new Error(
      typeof body.error === "string"
        ? body.error
        : `Local catalog service returned HTTP ${response.status}.`,
    );
  }
  return body as T;
}

function progressLine(label: string, job: CatalogImportJob): string {
  const counters =
    job.phase === "importing" || job.phase === "indexing"
      ? `; processed=${job.processedRecords.toLocaleString("en-US")}; imported=${(
          job.importedRecords ?? 0
        ).toLocaleString("en-US")}; rejected=${(
          job.rejectedRecords ?? 0
        ).toLocaleString("en-US")}`
      : "";
  return `${label}: ${job.phase}${counters}\n`;
}

async function waitForOutcome(
  request: typeof fetch,
  statusUrl: string,
  controlToken: string,
  label: string,
  options: Required<
    Pick<
      CatalogImportCommandOptions,
      "pollIntervalMs" | "wait" | "writeStandardOutput"
    >
  >,
): Promise<CatalogOutcome> {
  let previousProgress = "";
  for (;;) {
    const status = await responseJson<CatalogStatus>(
      await request(statusUrl, {
        headers: { Authorization: `Bearer ${controlToken}` },
      }),
    );
    if (status.outcome) return status.outcome;
    if (!status.job) throw new Error(`${label} import status is unavailable.`);

    const progress = progressLine(label, status.job);
    if (progress !== previousProgress) {
      options.writeStandardOutput(progress);
      previousProgress = progress;
    }
    await options.wait(options.pollIntervalMs);
  }
}

export async function runCatalogImportCommand(
  arguments_: string[] = process.argv.slice(2),
  options: CatalogImportCommandOptions = {},
): Promise<number> {
  const writeStandardOutput =
    options.writeStandardOutput ??
    ((value: string) => process.stdout.write(value));
  const writeStandardError =
    options.writeStandardError ??
    ((value: string) => process.stderr.write(value));
  const wait =
    options.wait ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));

  try {
    const { archivePath, provider } = parseArguments(arguments_);
    const archive = await lstat(archivePath);
    if (!archive.isFile() || archive.isSymbolicLink() || archive.size <= 0) {
      throw new Error("Archive path must identify a non-empty regular file.");
    }

    const label = labels[provider];
    const request = options.fetch ?? fetch;
    const controlToken =
      options.controlToken ?? (await readLocalCatalogImportToken());
    const baseUrl = (options.baseUrl ?? localCatalogImportBaseUrl()).replace(
      /\/$/,
      "",
    );
    writeStandardOutput(
      `${label}: submitting ${archivePath} (${archive.size.toLocaleString("en-US")} bytes)\n`,
    );
    const accepted = await responseJson<{ jobId: string }>(
      await request(`${baseUrl}/internal/catalog-imports`, {
        body: JSON.stringify({ archivePath, provider }),
        headers: {
          Authorization: `Bearer ${controlToken}`,
          "Content-Type": "application/json",
        },
        method: "POST",
      }),
    );
    const outcome = await waitForOutcome(
      request,
      `${baseUrl}/internal/catalog-imports/${provider}/${accepted.jobId}`,
      controlToken,
      label,
      {
        pollIntervalMs: options.pollIntervalMs ?? 1_000,
        wait,
        writeStandardOutput,
      },
    );

    if (outcome.phase !== "succeeded") {
      writeStandardError(
        `${label} import ${outcome.phase}: ${outcome.error ?? "No error detail was recorded."}\n`,
      );
      return 1;
    }

    writeStandardOutput(
      `${label}: succeeded; ${(outcome.installed?.foodCount ?? 0).toLocaleString(
        "en-US",
      )} foods installed\n`,
    );
    return 0;
  } catch (error) {
    writeStandardError(
      `${error instanceof Error ? error.message : "Catalog import failed."}\n`,
    );
    return 1;
  }
}

const invokedPath = process.argv[1];
if (
  invokedPath &&
  pathToFileURL(path.resolve(invokedPath)).href === import.meta.url
) {
  process.exitCode = await runCatalogImportCommand();
}
