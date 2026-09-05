import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { UsdaAnalysisReader, UsdaEvidence } from "../catalog/usda.server";
import type { ApplicationDatabaseClient } from "../database/database.server";
import {
  PhotoAnalysisStore,
  type PhotoMealRow,
} from "../database/photo-analysis.server";
import { localDateAt, parseIsoLocalDate } from "../food-log/date";
import {
  localEventTimeForNewFoodLogEvent,
  nextUpdatedAt,
} from "../food-log/event-time.server";
import { validatePhotoResult, type PhotoResult } from "./result.server";

export type PlatePhoto = { bytes: Buffer; mimeType: string };
export type PhotoAnalyzer = {
  analyze(input: {
    photo: PlatePhoto;
    signal: AbortSignal;
    correction?: string;
    previousCorrections: string[];
    currentResult?: unknown;
    currentEntry?: unknown;
    evidence: UsdaEvidence[];
    usda: {
      search(query: string, page: number): Promise<UsdaEvidence[]>;
      detail(id: string): Promise<UsdaEvidence>;
    };
  }): Promise<unknown>;
};
const keySchema = z
  .string()
  .min(8)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);

export class PhotoAnalysisService {
  private readonly store: PhotoAnalysisStore;
  private readonly controllers = new Map<string, AbortController>();
  private readonly usda?: UsdaAnalysisReader;
  private readonly rounds: number;
  private readonly deadlineMs: number;
  private readonly now: () => Date;
  constructor(
    private readonly database: ApplicationDatabaseClient,
    private readonly analyzer: PhotoAnalyzer,
    options: {
      now?: () => Date;
      deadlineMs?: number;
      usda?: UsdaAnalysisReader;
      rounds?: number;
    } = {},
  ) {
    this.store = new PhotoAnalysisStore(database);
    this.now = options.now ?? (() => new Date());
    this.usda = options.usda;
    this.rounds = options.rounds ?? 3;
    this.deadlineMs = options.deadlineMs ?? 20000;
    this.store.interrupt(this.now().toISOString());
  }

  start(
    userId: number,
    input: { photo: PlatePhoto; foodLogDate: string; idempotencyKey: string },
  ) {
    keySchema.parse(input.idempotencyKey);
    const repeated = this.store.repeated(userId, input.idempotencyKey);
    if (repeated) return this.status(userId, repeated.mealId);
    validatePlatePhoto(input.photo);
    const timeZone = this.store.timeZone(userId);
    const instant = this.now();
    if (
      !timeZone ||
      !parseIsoLocalDate(input.foodLogDate) ||
      input.foodLogDate > localDateAt(instant, timeZone)
    )
      throw new Error("Invalid Food Log date");
    const meal: PhotoMealRow = {
      id: randomUUID(),
      userId,
      entryId: null,
      photo: input.photo.bytes,
      mimeType: input.photo.mimeType,
      foodLogDate: input.foodLogDate,
      localEventTime: localEventTimeForNewFoodLogEvent(
        this.database,
        userId,
        input.foodLogDate,
        localDateAt(instant, timeZone),
        instant,
        timeZone,
      ),
      createdAt: instant.toISOString(),
    };
    const attemptId = randomUUID();
    this.store.start(meal, {
      id: attemptId,
      mealId: meal.id,
      userId,
      idempotencyKey: input.idempotencyKey,
      status: "active",
      stage: "Analyzing photo",
      startedAt: meal.createdAt,
    });
    void this.run(meal, attemptId);
    return this.status(userId, meal.id);
  }

  status(userId: number, id: string) {
    const meal = this.store.meal(userId, id);
    if (!meal) throw new Error("Photo meal unavailable");
    const attempt = this.store.history(id).at(-1)!;
    return {
      ...attempt,
      id,
      attemptId: attempt.id,
      entryId: meal.entryId,
      foodLogDate: meal.foodLogDate,
    };
  }

  list(userId: number, date: string) {
    if (!parseIsoLocalDate(date)) throw new Error("Invalid Food Log date");
    return this.store.list(userId, date).map(({ id }) => this.view(userId, id));
  }

  view(userId: number, id: string) {
    const status = this.status(userId, id);
    const entry =
      status.entryId === null
        ? undefined
        : this.store.entry(userId, status.entryId);
    const result = [...this.store.history(id)]
      .reverse()
      .find((item) => item.result)?.result;
    return {
      id,
      entryId: status.entryId,
      foodLogDate: status.foodLogDate,
      status: status.status,
      stage: status.stage,
      attemptId: status.attemptId,
      startedAt: status.startedAt,
      finishedAt: status.finishedAt,
      error: status.error,
      energyMilliKcal: entry?.energyMilliKcal ?? null,
      result: result ? (JSON.parse(result) as PhotoResult) : null,
    };
  }

  history(userId: number, id: string) {
    this.status(userId, id);
    return this.store.history(id);
  }

  correct(
    userId: number,
    entryId: number,
    input: { correction: string; idempotencyKey: string },
  ) {
    const correction = z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .parse(input.correction);
    keySchema.parse(input.idempotencyKey);
    const meal = this.store.forEntry(
      userId,
      z.number().int().positive().parse(entryId),
    );
    if (!meal) throw new Error("Photo meal unavailable");
    const repeated = this.store.repeated(userId, input.idempotencyKey);
    if (repeated) {
      if (repeated.mealId !== meal.id)
        throw new Error("Request key belongs to another meal");
      return this.status(userId, meal.id);
    }
    const current = this.status(userId, meal.id);
    if (current.status === "active")
      throw new Error("Analysis is already processing");
    return this.startAttempt(meal, input.idempotencyKey, correction);
  }

  private startAttempt(
    meal: PhotoMealRow,
    idempotencyKey: string,
    correction: string | null,
  ) {
    const current = this.status(meal.userId, meal.id);
    const attemptId = randomUUID();
    this.store.attempt({
      id: attemptId,
      mealId: meal.id,
      userId: meal.userId,
      idempotencyKey,
      status: "active",
      stage: "Analyzing photo",
      correction,
      startedAt: nextUpdatedAt(this.now(), current.startedAt),
    });
    void this.run(meal, attemptId);
    return this.status(meal.userId, meal.id);
  }

  cancel(userId: number, id: string, attemptId: string) {
    const current = this.status(userId, id);
    if (current.attemptId !== attemptId)
      throw new Error("This attempt has changed");
    this.store.finish(
      attemptId,
      "canceled",
      "Analysis canceled. Retry when ready.",
      this.now().toISOString(),
    );
    this.controllers.get(attemptId)?.abort();
    return this.status(userId, id);
  }

  retry(
    userId: number,
    id: string,
    input: { idempotencyKey: string; attemptId: string },
  ) {
    keySchema.parse(input.idempotencyKey);
    const current = this.status(userId, id);
    const repeated = this.store.repeated(userId, input.idempotencyKey);
    if (repeated) {
      if (repeated.mealId !== id)
        throw new Error("Request key belongs to another meal");
      return current;
    }
    if (
      current.attemptId !== input.attemptId ||
      current.status === "active" ||
      current.status === "succeeded"
    )
      throw new Error("This attempt cannot be retried");
    return this.startAttempt(
      this.store.meal(userId, id)!,
      input.idempotencyKey,
      current.correction,
    );
  }

  photo(userId: number, id: string): PlatePhoto {
    const meal = this.store.meal(userId, id);
    if (!meal) throw new Error("Photo meal unavailable");
    return { bytes: meal.photo, mimeType: meal.mimeType };
  }

  delete(userId: number, id: string) {
    const current = this.status(userId, id);
    if (current.status === "active")
      throw new Error("Cancel the active analysis before deleting it");
    this.store.delete(this.store.meal(userId, id)!);
  }

  shutdown() {
    for (const [id, controller] of this.controllers) {
      this.store.finish(
        id,
        "interrupted",
        "Server stopped. Retry this analysis.",
        this.now().toISOString(),
      );
      controller.abort();
    }
  }

  private retainedEvidence(history: ReturnType<PhotoAnalysisStore["history"]>) {
    const evidence = new Map<string, UsdaEvidence>();
    for (const attempt of history.slice(-3)) {
      for (const item of JSON.parse(attempt.evidence) as UsdaEvidence[])
        evidence.set(item.food.providerFoodId, item);
    }
    return evidence;
  }

  private usdaTools(
    attemptId: string,
    signal: AbortSignal,
    evidence: Map<string, UsdaEvidence>,
  ) {
    let searches = 0;
    let details = 0;
    const retain = (items: UsdaEvidence[]) => {
      signal.throwIfAborted();
      for (const item of items) evidence.set(item.food.providerFoodId, item);
      if (JSON.stringify([...evidence.values()]).length > 750000)
        throw new Error("USDA context limit reached");
      this.store.progress(
        attemptId,
        "Consulting USDA",
        JSON.stringify([...evidence.values()]),
      );
    };
    return {
      search: async (query: string, page: number) => {
        signal.throwIfAborted();
        if (++searches > this.rounds || !this.usda)
          throw new Error(
            "USDA unavailable or search limit reached. Use explicit estimates if appropriate.",
          );
        this.store.progress(
          attemptId,
          "Consulting USDA",
          JSON.stringify([...evidence.values()]),
        );
        const items = await this.usda.searchEvidence(query, page, signal);
        retain(items);
        return items;
      },
      detail: async (id: string) => {
        signal.throwIfAborted();
        if (++details > 6 || !this.usda)
          throw new Error("USDA detail limit reached or unavailable");
        const item = await this.usda.getEvidence(id, signal);
        retain([item]);
        return item;
      },
    };
  }

  private analysisInput(
    meal: PhotoMealRow,
    attemptId: string,
    signal: AbortSignal,
  ) {
    const history = this.store.history(meal.id);
    const current = history.find((item) => item.id === attemptId)!;
    const previous = history.filter((item) => item.id !== attemptId);
    const previousResult = [...previous]
      .reverse()
      .find((item) => item.status === "succeeded")?.result;
    const evidence = this.retainedEvidence(previous);
    const currentEntry =
      meal.entryId === null
        ? undefined
        : this.store.entry(meal.userId, meal.entryId);
    const input = {
      photo: { bytes: meal.photo, mimeType: meal.mimeType },
      signal,
      correction: current.correction ?? undefined,
      previousCorrections: previous
        .slice(-10)
        .flatMap((item) => (item.correction ? [item.correction] : [])),
      currentEntry,
      currentResult: previousResult
        ? (JSON.parse(previousResult) as unknown)
        : undefined,
      evidence: [...evidence.values()],
      usda: this.usdaTools(attemptId, signal, evidence),
    };
    return { input, current, currentEntry, evidence };
  }

  private async run(meal: PhotoMealRow, attemptId: string) {
    const controller = new AbortController();
    this.controllers.set(attemptId, controller);
    const deadline = performance.now() + this.deadlineMs;
    const timer = setTimeout(() => {
      this.store.finish(
        attemptId,
        "failed",
        "Analysis timed out. Retry when ready.",
        this.now().toISOString(),
      );
      controller.abort();
    }, this.deadlineMs);
    timer.unref();
    const aborted = new Promise<never>((_resolve, reject) => {
      controller.signal.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new Error("Analysis stopped"));
        },
        { once: true },
      );
    });
    try {
      const { input, current, currentEntry, evidence } = this.analysisInput(
        meal,
        attemptId,
        controller.signal,
      );
      const value = await Promise.race([aborted, this.analyzer.analyze(input)]);
      controller.signal.throwIfAborted();
      this.store.progress(
        attemptId,
        "Preparing result",
        JSON.stringify([...evidence.values()]),
      );
      const { result, snapshot } = validatePhotoResult(value, meal.id, [
        ...evidence.values(),
      ]);
      if (performance.now() >= deadline) {
        this.store.finish(
          attemptId,
          "failed",
          "Analysis timed out. Retry when ready.",
          this.now().toISOString(),
        );
        return;
      }
      this.store.complete(
        meal,
        attemptId,
        snapshot,
        JSON.stringify(result),
        nextUpdatedAt(
          this.now(),
          [current.startedAt, currentEntry?.updatedAt ?? ""].sort().at(-1)!,
        ),
      );
    } catch {
      if (controller.signal.aborted) return;
      this.store.finish(
        attemptId,
        "failed",
        "Analysis failed. Retry or use another food-entry method.",
        this.now().toISOString(),
      );
    } finally {
      clearTimeout(timer);
      this.controllers.delete(attemptId);
    }
  }
}

function photoHasSignature(bytes: Buffer, mimeType: string) {
  switch (mimeType) {
    case "image/png":
      return bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    case "image/jpeg":
      return (
        bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255])) &&
        bytes.subarray(-2).equals(Buffer.from([255, 217]))
      );
    case "image/webp":
      return (
        bytes.toString("ascii", 0, 4) === "RIFF" &&
        bytes.toString("ascii", 8, 12) === "WEBP"
      );
    default:
      return false;
  }
}

function validatePlatePhoto(photo: PlatePhoto) {
  if (photo.bytes.length < 12 || photo.bytes.length > 8388608)
    throw new Error("Choose a photo up to 8 MB");
  if (!photoHasSignature(photo.bytes, photo.mimeType))
    throw new Error("Choose a JPEG, PNG, or WebP photo");
}
