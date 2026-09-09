import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { chmod, mkdir, rm, statfs } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Worker } from "node:worker_threads";
import type { ApplicationDatabaseClient } from "../database/database.server";
import { claimCatalogInstallation, readCatalogState, saveCatalogState } from "../database/catalog-state.server";

export type ImportPhase = "uploading" | "queued" | "validating" | "importing" | "indexing" | "activating" | "succeeded" | "failed" | "interrupted";
export type CatalogImportJob = {
  id: string; filename: string; phase: ImportPhase; receivedBytes: number;
  processedRecords: number; importedRecords?: number; rejectedRecords?: number;
  exclusions: Record<string, number>; error: string | null;
  startedAt: string; updatedAt: string;
};
export type InstalledCatalog = {
  generation: string; filename: string; sha256: string; foodCount: number;
  installedAt: string; publicationDateRange: { earliest: string; latest: string };
  sourceDateRange?: { earliest: string | null; latest: string | null };
};
export type CatalogState = { installed: InstalledCatalog | null; job: CatalogImportJob | null; busy: boolean; retiring?: InstalledCatalog };
export type CatalogManagementOptions = { provider?: "usda-fdc" | "open-food-facts"; directory: string; workerPath: string; maxUploadBytes?: number; maxExpandedBytes?: number };
const terminal = new Set<ImportPhase>(["succeeded", "failed", "interrupted"]);
export class CatalogManagementError extends Error {}

export class CatalogManagement {
  readonly #database: ApplicationDatabaseClient;
  readonly #options: Required<CatalogManagementOptions>;
  #worker: Worker | undefined;
  #upload: AbortController | undefined;
  #operation: Promise<void> | undefined;
  #handoff: Promise<void> | undefined;
  readonly #readers = new Map<string, Set<object>>();

  constructor(database: ApplicationDatabaseClient, options: CatalogManagementOptions) {
    this.#database = database;
    const off = options.provider === "open-food-facts";
    this.#options = { provider: "usda-fdc", maxUploadBytes: (off ? 4096 : 64) * 1024 * 1024, maxExpandedBytes: (off ? 32768 : 256) * 1024 * 1024, ...options };
    const state = this.read();
    if (state.retiring && state.job?.phase === "failed" && state.installed?.generation === state.job.id) {
      this.#updateJob({ phase: "activating", error: null });
      void this.#completeHandoff();
    } else if (state.busy && state.job) {
      if (state.job.phase === "activating" && state.installed?.generation === state.job.id) {
        void this.#completeHandoff();
      } else {
        this.#updateJob({ phase: "interrupted", error: `${this.#label} installation was interrupted by a server restart. Upload the archive again.` });
        void this.#cleanup(state.job.id, true);
      }
    }
  }

  get #label() { return this.#options.provider === "open-food-facts" ? "Open Food Facts" : "USDA"; }
  get #extension() { return this.#options.provider === "open-food-facts" ? ".gz" : ".zip"; }

  read(): CatalogState {
    const state = readCatalogState(this.#database, this.#options.provider);
    return { ...state, busy: state.job !== null && !terminal.has(state.job.phase) };
  }

  async submitArchive(input: { filename: string; stream: Readable; size?: number }): Promise<void> {
    if (!input.filename.toLowerCase().endsWith(this.#extension) || input.filename.length > 255) throw new CatalogManagementError(`Choose a ${this.#label} ${this.#extension} archive.`);
    if (input.size !== undefined && (!Number.isSafeInteger(input.size) || input.size <= 0 || input.size > this.#options.maxUploadBytes)) throw new CatalogManagementError("Archive exceeds the configured upload limit or is empty.");
    const id = randomUUID();
    const now = new Date().toISOString();
    const conflict = claimCatalogInstallation(this.#database, { id, filename: path.basename(input.filename), phase: "uploading", receivedBytes: 0, processedRecords: 0, importedRecords: 0, rejectedRecords: 0, exclusions: {}, error: null, startedAt: now, updatedAt: now }, this.#options.provider);
    if (conflict === "busy") throw new CatalogManagementError(`A ${this.#label} installation is already running.`);
    this.#upload = new AbortController();
    this.#operation = this.#receive(input, id, this.#upload.signal);
    await this.#operation;
  }

  async #receive(input: { stream: Readable; size?: number }, id: string, signal: AbortSignal) {
    const archivePath = path.join(this.#options.directory, `${id}${this.#extension}`);
    try {
      await mkdir(this.#options.directory, { recursive: true, mode: 0o700 });
      const space = await statfs(this.#options.directory);
      if (space.bavail * space.bsize < this.#options.maxExpandedBytes * 2 + (input.size ?? this.#options.maxUploadBytes)) throw new CatalogManagementError(`Not enough disk space for ${this.#label} import. Free space and retry.`);
      let receivedBytes = 0;
      let lastProgress = 0;
      const hash = createHash("sha256");
      const limit = this.#options.maxUploadBytes;
      const meter = new Transform({ transform: (chunk: Buffer, _encoding, callback) => {
        receivedBytes += chunk.length;
        if (receivedBytes > limit) { callback(new CatalogManagementError("Archive exceeds the configured upload limit.")); return; }
        hash.update(chunk);
        if (Date.now() - lastProgress > 250) { this.#updateJob({ receivedBytes }); lastProgress = Date.now(); }
        callback(null, chunk);
      } });
      await pipeline(input.stream, meter, createWriteStream(archivePath, { flags: "wx", mode: 0o600 }), { signal });
      if (receivedBytes === 0 || (input.size !== undefined && receivedBytes !== input.size)) throw new CatalogManagementError("Upload was empty or incomplete. Upload the archive again.");
      this.#updateJob({ receivedBytes, phase: "queued" });
      this.#startWorker(id, archivePath, hash.digest("hex"));
    } catch (error) {
      this.#updateJob({ phase: "failed", error: error instanceof CatalogManagementError ? error.message : `${this.#label} upload failed. Check available disk space and upload the archive again.` });
      await this.#cleanup(id, true);
    } finally { this.#upload = undefined; }
  }

  #startWorker(id: string, archivePath: string, sha256: string) {
    const worker = new Worker(this.#options.workerPath, { workerData: { provider: this.#options.provider, archivePath, directory: this.#options.directory, generation: id, maxExpandedBytes: this.#options.maxExpandedBytes }, execArgv: [] });
    this.#worker = worker;
    let result: { foodCount: number; publicationDateRange: InstalledCatalog["publicationDateRange"] } | undefined;
    worker.on("message", (message: { progress?: Partial<CatalogImportJob>; result?: typeof result; error?: string }) => {
      if (message.progress) this.#updateJob(message.progress);
      if (message.result) result = message.result;
      if (message.error) this.#updateJob({ error: message.error });
    });
    worker.on("error", () => this.#updateJob({ error: `${this.#label} import worker failed. Check server storage and retry the upload.` }));
    worker.on("exit", (code) => {
      this.#operation = this.#finish(id, sha256, code === 0 ? result : undefined);
    });
  }

  #canActivate(job: CatalogImportJob | null, id: string): boolean {
    if (!job || job.id !== id) return false;
    return !job.error && !terminal.has(job.phase);
  }

  async #finish(id: string, sha256: string, result: { foodCount: number; publicationDateRange: InstalledCatalog["publicationDateRange"] } | undefined) {
    const state = this.read();
    try {
      if (result && this.#canActivate(state.job, id)) {
        this.#updateJob({ phase: "activating" });
        await chmod(path.join(this.#options.directory, `${id}.sqlite`), 0o444);
        await this.#cleanup(id, false);
        this.#worker = undefined;
        const now = new Date().toISOString();
        this.#save({ installed: { generation: id, filename: state.job!.filename, sha256, installedAt: now, ...result }, job: { ...this.read().job!, phase: "activating", updatedAt: now }, retiring: state.installed ?? undefined });
        await this.#completeHandoff();
      } else {
        await this.#cleanup(id, true);
        this.#worker = undefined;
        if (state.busy) this.#updateJob({ phase: "failed", error: state.job?.error ?? `${this.#label} import stopped before completion. Upload the archive again.` });
      }
    } catch {
      await this.#cleanup(id, this.read().installed?.generation !== id);
      this.#worker = undefined;
      this.#updateJob({ phase: "failed", error: `${this.#label} activation failed. Check server storage and retry the upload.` });
    }
  }

  #save(state: Omit<CatalogState, "busy">) {
    saveCatalogState(this.#database, state, this.#options.provider);
  }
  #updateJob(patch: Partial<CatalogImportJob>) {
    const state = this.read();
    if (state.job) this.#save({ installed: state.installed, job: { ...state.job, ...patch, updatedAt: new Date().toISOString() }, retiring: state.retiring });
  }
  async withActiveGeneration<T>(read: (generation: string) => T | Promise<T>): Promise<T | undefined> {
    const generation = this.read().installed?.generation;
    if (!generation) return undefined;
    const lease = {};
    const readers = this.#readers.get(generation) ?? new Set<object>();
    readers.add(lease);
    this.#readers.set(generation, readers);
    try {
      return await read(generation);
    } finally {
      readers.delete(lease);
      await this.#completeHandoff();
    }
  }
  async #completeHandoff() {
    if (this.#handoff) return this.#handoff;
    const state = this.read();
    if (!this.#handoffReady(state)) return;
    const handoff = this.#retireAndComplete(state);
    this.#handoff = handoff;
    try {
      await handoff;
    } catch {
      this.#updateJob({ phase: "failed", error: `${this.#label} catalog handoff failed. The replacement remains active; check catalog storage and restart the server.` });
    } finally {
      if (this.#handoff === handoff) this.#handoff = undefined;
    }
  }
  #handoffReady(state: CatalogState) {
    return state.job?.phase === "activating"
      && state.installed?.generation === state.job.id
      && (!state.retiring || !this.#readers.get(state.retiring.generation)?.size);
  }
  async #retireAndComplete(state: CatalogState) {
    if (state.retiring) await this.#removeGeneration(state.retiring.generation);
    this.#save({ installed: state.installed, job: { ...state.job!, phase: "succeeded", updatedAt: new Date().toISOString() } });
  }
  async #removeGeneration(generation: string) {
    await rm(path.join(this.#options.directory, `${generation}.sqlite`), { force: true });
    await rm(path.join(this.#options.directory, `${generation}.sqlite-journal`), { force: true });
    this.#readers.delete(generation);
  }
  async #cleanup(id: string, removeGeneration: boolean) {
    const paths = [`${id}${this.#extension}`, `${id}.staging`, ...(removeGeneration ? [`${id}.sqlite`, `${id}.sqlite-journal`] : [])];
    await Promise.all(paths.map(name => rm(path.join(this.#options.directory, name), { recursive: true, force: true }).catch(() => undefined)));
  }
  async shutdown() {
    this.#upload?.abort();
    await this.#operation;
    if (this.#worker) {
      this.#updateJob({ phase: "interrupted", error: `${this.#label} installation was interrupted by server shutdown. Upload the archive again.` });
      await this.#worker.terminate();
      await this.#operation;
    }
  }
}
