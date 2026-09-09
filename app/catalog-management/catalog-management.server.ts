import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, statSync } from "node:fs";
import { chmod, mkdir, readdir, rm, stat, statfs } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Worker } from "node:worker_threads";
import type { ApplicationDatabaseClient } from "../database/database.server";
import { catalogGenerationIsReadable } from "../database/catalog-generation-validation.server";
import { claimCatalogInstallation, readCatalogState, readCatalogUpdateCheck, saveCatalogState, saveCatalogUpdateCheck } from "../database/catalog-state.server";

export type ImportPhase = "uploading" | "queued" | "validating" | "importing" | "indexing" | "activating" | "succeeded" | "failed" | "interrupted";
export type CatalogImportJob = {
  id: string; filename: string; phase: ImportPhase; receivedBytes: number;
  processedRecords: number; importedRecords?: number; rejectedRecords?: number;
  exclusions: Record<string, number>; error: string | null;
  startedAt: string; updatedAt: string;
  sourceReleaseCandidate?: FoundationReleaseMetadata;
};
export type InstalledCatalog = {
  generation: string; filename: string; sha256: string; foodCount: number;
  databaseBytes?: number;
  installedAt: string; publicationDateRange: { earliest: string; latest: string };
  sourceDateRange?: { earliest: string | null; latest: string | null };
  sourceRelease?: Omit<FoundationReleaseMetadata, "archiveUrl">;
};
export type FoundationReleaseMetadata = {
  releasePeriod: string;
  identifier: string | null;
  releasedOn: string | null;
  archiveUrl: string;
  archiveFilename: string;
  archiveByteLength: number;
};
export type CatalogUpdateCheck = {
  status: "newer" | "unchanged" | "unavailable" | "indeterminate";
  checkedAt: string;
  availableRelease: FoundationReleaseMetadata | null;
  error: string | null;
};
export type CatalogSourceTransport = { latestFoundationRelease(): Promise<FoundationReleaseMetadata | null> };
export type CatalogState = { installed: InstalledCatalog | null; job: CatalogImportJob | null; busy: boolean; retiring?: InstalledCatalog; updateCheck?: CatalogUpdateCheck };
export type CatalogManagementOptions = {
  provider?: "usda-fdc" | "open-food-facts";
  directory: string;
  workerPath: string;
  maxUploadBytes?: number;
  maxExpandedBytes?: number;
  sourceTransport?: CatalogSourceTransport;
  now?: () => Date;
  updateCheckCacheMs?: number;
};
const terminal = new Set<ImportPhase>(["succeeded", "failed", "interrupted"]);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const releasePeriodPattern = /^\d{4}-(0[1-9]|1[0-2])$/;
function validExactDate(releasedOn: string | null, releasePeriod: string): boolean {
  if (releasedOn === null) return true;
  if (!datePattern.test(releasedOn) || !releasedOn.startsWith(`${releasePeriod}-`)) return false;
  const parsed = new Date(`${releasedOn}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === releasedOn;
}
function validDeclaredRelease(release: FoundationReleaseMetadata): boolean {
  const identifierValid = release.identifier === null || Boolean(release.identifier.trim());
  const exactDateValid = validExactDate(release.releasedOn, release.releasePeriod);
  return releasePeriodPattern.test(release.releasePeriod) && identifierValid && exactDateValid;
}
function validArchiveDescriptor(release: FoundationReleaseMetadata): boolean {
  return path.basename(release.archiveFilename) === release.archiveFilename
    && Number.isSafeInteger(release.archiveByteLength)
    && release.archiveByteLength > 0;
}
function trustedArchiveUrl(value: string): boolean {
  const archiveUrl = new URL(value);
  return archiveUrl.protocol === "https:" && archiveUrl.hostname === "fdc.nal.usda.gov";
}
function sameReleaseArtifact(installed: NonNullable<InstalledCatalog["sourceRelease"]>, available: FoundationReleaseMetadata): boolean {
  const versionsConflict = installed.identifier !== null && available.identifier !== null && installed.identifier !== available.identifier;
  const datesConflict = installed.releasedOn !== null && available.releasedOn !== null && installed.releasedOn !== available.releasedOn;
  const artifactMatches = installed.archiveFilename === available.archiveFilename && installed.archiveByteLength === available.archiveByteLength;
  return !versionsConflict && !datesConflict && artifactMatches;
}
export class CatalogManagementError extends Error {}

export class CatalogManagement {
  readonly #database: ApplicationDatabaseClient;
  readonly #options: Required<CatalogManagementOptions>;
  #worker: Worker | undefined;
  #upload: AbortController | undefined;
  #operation: Promise<void> | undefined;
  #handoff: Promise<void> | undefined;
  #checking: Promise<void> | undefined;
  readonly #maintenance: Promise<void>;
  readonly #readers = new Map<string, Set<object>>();

  constructor(database: ApplicationDatabaseClient, options: CatalogManagementOptions) {
    this.#database = database;
    const off = options.provider === "open-food-facts";
    this.#options = {
      provider: "usda-fdc",
      maxUploadBytes: (off ? 4096 : 64) * 1024 * 1024,
      maxExpandedBytes: (off ? 32768 : 256) * 1024 * 1024,
      sourceTransport: { latestFoundationRelease: async () => null },
      now: () => new Date(),
      updateCheckCacheMs: 6 * 60 * 60 * 1000,
      ...options,
    };
    this.#maintenance = this.#recoverOnStartup(this.read()).then(() => this.#cleanupAbandonedArtifacts());
  }

  #recoverOnStartup(state: CatalogState): Promise<void> {
    if (!state.job) return Promise.resolve();
    return state.busy ? this.#recoverBusyJob(state, state.job) : this.#recoverTerminalJob(state, state.job);
  }

  #recoverTerminalJob(state: CatalogState, job: CatalogImportJob): Promise<void> {
    if (job.phase === "failed" && state.retiring && state.installed?.generation === job.id) {
      this.#updateJob({ phase: "activating", error: null });
      return this.#recoverPublishedHandoff(this.read());
    }
    return Promise.resolve();
  }

  #recoverBusyJob(state: CatalogState, job: CatalogImportJob): Promise<void> {
    if (job.phase === "activating" && state.installed?.generation === job.id) return this.#recoverPublishedHandoff(state);
    this.#updateJob({ phase: "interrupted", error: `${this.#label} installation was interrupted by a server restart. Upload the archive again.` });
    return this.#cleanup(job.id, true);
  }

  get #label() { return this.#options.provider === "open-food-facts" ? "Open Food Facts" : "USDA"; }
  get #extension() { return this.#options.provider === "open-food-facts" ? ".gz" : ".zip"; }

  read(): CatalogState {
    const state = readCatalogState(this.#database, this.#options.provider);
    const updateCheck = this.#options.provider === "usda-fdc" ? readCatalogUpdateCheck(this.#database, this.#options.provider) : undefined;
    return { ...state, busy: state.job !== null && !terminal.has(state.job.phase), ...(updateCheck ? { updateCheck } : {}) };
  }

  async checkForUpdate(options: { force?: boolean } = {}): Promise<void> {
    if (this.#options.provider !== "usda-fdc") return;
    const now = this.#options.now();
    const cached = readCatalogUpdateCheck(this.#database, this.#options.provider);
    if (!options.force && cached && now.getTime() - Date.parse(cached.checkedAt) < this.#options.updateCheckCacheMs) return;
    if (this.#checking) return this.#checking;
    const checking = this.#performUpdateCheck(now);
    this.#checking = checking;
    try { await checking; } finally { if (this.#checking === checking) this.#checking = undefined; }
  }

  async #performUpdateCheck(now: Date): Promise<void> {
    const checkedAt = now.toISOString();
    try {
      const availableRelease = this.#validRelease(await this.#options.sourceTransport.latestFoundationRelease());
      if (!availableRelease) {
        saveCatalogUpdateCheck(this.#database, { status: "indeterminate", checkedAt, availableRelease: null, error: null }, this.#options.provider);
        return;
      }
      const status = this.#updateStatus(this.read().installed?.sourceRelease, availableRelease);
      saveCatalogUpdateCheck(this.#database, { status, checkedAt, availableRelease, error: null }, this.#options.provider);
    } catch {
      saveCatalogUpdateCheck(this.#database, { status: "unavailable", checkedAt, availableRelease: null, error: "Official USDA release metadata could not be checked." }, this.#options.provider);
    }
  }

  #validRelease(release: FoundationReleaseMetadata | null): FoundationReleaseMetadata | null {
    try {
      if (!release || !validDeclaredRelease(release) || !validArchiveDescriptor(release) || !trustedArchiveUrl(release.archiveUrl)) return null;
      return { ...release, identifier: release.identifier?.trim() ?? null };
    } catch { return null; }
  }

  #updateStatus(installed: InstalledCatalog["sourceRelease"], available: FoundationReleaseMetadata): CatalogUpdateCheck["status"] {
    if (!installed || !releasePeriodPattern.test(installed.releasePeriod)) return "indeterminate";
    if (installed.releasePeriod < available.releasePeriod) return "newer";
    if (installed.releasePeriod > available.releasePeriod) return "indeterminate";
    return sameReleaseArtifact(installed, available) ? "unchanged" : "indeterminate";
  }

  async submitArchive(input: { filename: string; stream: Readable; size?: number }): Promise<void> {
    await this.#maintenance;
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
      if (space.bavail * space.bsize < this.#requiredFreeBytes(input.size)) throw new CatalogManagementError(`Not enough disk space for ${this.#label} import. Free space and retry.`);
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
      this.#updateJob({ receivedBytes, phase: "queued", sourceReleaseCandidate: this.#releaseForUpload(receivedBytes) });
      this.#startWorker(id, archivePath, hash.digest("hex"));
    } catch (error) {
      this.#updateJob(this.#uploadFailure(error, signal.aborted));
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
        await this.#activate(id, sha256, result, state);
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

  async #activate(id: string, sha256: string, result: { foodCount: number; publicationDateRange: InstalledCatalog["publicationDateRange"] }, state: CatalogState) {
    this.#updateJob({ phase: "activating" });
    const generationPath = path.join(this.#options.directory, `${id}.sqlite`);
    await chmod(generationPath, 0o444);
    const generationFile = await stat(generationPath);
    if (!generationFile.isFile() || generationFile.size <= 0) throw new Error("Invalid catalog generation");
    await this.#cleanup(id, false);
    this.#worker = undefined;
    const now = new Date().toISOString();
    const installed = { generation: id, filename: state.job!.filename, sha256, databaseBytes: generationFile.size, installedAt: now, ...result, ...this.#matchingSourceRelease(state.job!) };
    this.#save({ installed, job: { ...this.read().job!, phase: "activating", updatedAt: now }, retiring: state.installed ?? undefined });
    this.#reconcileUpdateCheck(installed);
    await this.#completeHandoff();
  }

  #uploadFailure(error: unknown, interrupted: boolean): Pick<CatalogImportJob, "phase" | "error"> {
    if (interrupted) return { phase: "interrupted", error: `${this.#label} installation was interrupted by server shutdown. Upload the archive again.` };
    return { phase: "failed", error: error instanceof CatalogManagementError ? error.message : `${this.#label} upload failed. Check available disk space and upload the archive again.` };
  }

  #save(state: Omit<CatalogState, "busy">) {
    saveCatalogState(this.#database, state, this.#options.provider);
  }
  #updateJob(patch: Partial<CatalogImportJob>) {
    const state = this.read();
    if (state.job) this.#save({ installed: state.installed, job: { ...state.job, ...patch, updatedAt: new Date().toISOString() }, retiring: state.retiring });
  }
  #matchingSourceRelease(job: CatalogImportJob): Pick<InstalledCatalog, "sourceRelease"> {
    const release = job.sourceReleaseCandidate;
    return release ? { sourceRelease: { releasePeriod: release.releasePeriod, identifier: release.identifier, releasedOn: release.releasedOn, archiveFilename: release.archiveFilename, archiveByteLength: release.archiveByteLength } } : {};
  }
  #releaseForUpload(receivedBytes: number): FoundationReleaseMetadata | undefined {
    const state = readCatalogState(this.#database, this.#options.provider);
    const release = readCatalogUpdateCheck(this.#database, this.#options.provider)?.availableRelease;
    return release && state.job?.filename === release.archiveFilename && receivedBytes === release.archiveByteLength ? release : undefined;
  }
  #reconcileUpdateCheck(installed: InstalledCatalog) {
    const check = readCatalogUpdateCheck(this.#database, this.#options.provider);
    if (!check?.availableRelease) return;
    saveCatalogUpdateCheck(this.#database, { ...check, status: this.#updateStatus(installed.sourceRelease, check.availableRelease) }, this.#options.provider);
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
  async #recoverPublishedHandoff(state: CatalogState) {
    const replacement = state.installed!;
    if (this.#generationIsRecoverable(replacement)) {
      await this.#completeHandoff();
      return;
    }
    const previous = state.retiring;
    const previousAvailable = previous && this.#generationIsRecoverable(previous);
    const job = {
      ...state.job!,
      phase: "interrupted" as const,
      error: previousAvailable
        ? `${this.#label} replacement could not be confirmed after restart. The previous catalog remains active. Upload the archive again.`
        : `${this.#label} replacement could not be confirmed after restart and no previous catalog is available. Upload the archive again.`,
      updatedAt: new Date().toISOString(),
    };
    this.#save({ installed: previousAvailable ? previous : null, job });
    await this.#cleanup(replacement.generation, true);
  }
  #generationIsRecoverable(generation: InstalledCatalog) {
    const generationPath = path.join(this.#options.directory, `${generation.generation}.sqlite`);
    const actualBytes = statSync(generationPath, { throwIfNoEntry: false })?.size;
    if (actualBytes === undefined) return false;
    if (generation.databaseBytes !== undefined && generation.databaseBytes !== actualBytes) return false;
    return catalogGenerationIsReadable(this.#options.directory, generation.generation, this.#options.provider);
  }
  #requiredFreeBytes(uploadBytes: number | undefined) {
    const stagedBytes = this.#options.maxExpandedBytes * (this.#options.provider === "usda-fdc" ? 2 : 1);
    return stagedBytes + (uploadBytes ?? this.#options.maxUploadBytes);
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
  async #cleanupAbandonedArtifacts() {
    const protectedIds = new Set<string>();
    for (const provider of ["usda-fdc", "open-food-facts"] as const) {
      const state = readCatalogState(this.#database, provider);
      if (state.installed) protectedIds.add(state.installed.generation);
      if (state.retiring) protectedIds.add(state.retiring.generation);
      if (state.job && !terminal.has(state.job.phase)) protectedIds.add(state.job.id);
    }
    const generationArtifact = /^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(?:sqlite(?:-journal)?|zip|gz|staging)$/i;
    let names: string[];
    try { names = await readdir(this.#options.directory); } catch { return; }
    await Promise.all(names.map(async name => {
      const generation = generationArtifact.exec(name)?.[1];
      if (!generation || protectedIds.has(generation)) return;
      await rm(path.join(this.#options.directory, name), { recursive: true, force: true }).catch(() => undefined);
    }));
  }
  async shutdown() {
    await this.#maintenance;
    this.#upload?.abort();
    await this.#operation;
    if (this.#worker) {
      this.#updateJob({ phase: "interrupted", error: `${this.#label} installation was interrupted by server shutdown. Upload the archive again.` });
      await this.#worker.terminate();
      await this.#operation;
    }
  }
}
