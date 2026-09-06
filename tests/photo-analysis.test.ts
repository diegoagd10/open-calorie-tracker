import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import {
  openApplicationDatabase,
  type ApplicationDatabase,
} from "../app/database/database.server";
import { users, userPreferences } from "../app/database/schema.server";
import {
  PiPhotoAnalyzer,
  type PiMessage,
} from "../app/photo-analysis/pi.server";
import { FoodEntryService } from "../app/food-entry/food-entry.server";
import {
  UsdaFoodDataCentralAdapter,
  type UsdaAnalysisReader,
} from "../app/catalog/usda.server";
import { FoodLogService } from "../app/food-log/food-log.server";
import {
  PhotoAnalysisService,
  type PhotoAnalyzer,
} from "../app/photo-analysis/photo-analysis.server";

const services: PhotoAnalysisService[] = [];
const databases: ApplicationDatabase[] = [];
const directories: string[] = [];
afterEach(async () => {
  services.splice(0).forEach((service) => service.shutdown());
  await Promise.resolve();
  databases.splice(0).forEach((db) => db.close());
  await Promise.all(
    directories
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true })),
  );
});
const photo = {
  mimeType: "image/png",
  bytes: Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFElEQVR4nGP4TyJgGNUwqmH4agAAr639H708R/EAAAAASUVORK5CYII=",
    "base64",
  ),
};
function estimate(energy = 250) {
  return {
    name: "Rice plate",
    consumedFraction: 1,
    assumptions: ["Estimated portion from photo"],
    components: [
      {
        id: "rice",
        name: "Cooked rice",
        quantity: 200,
        unit: "g",
        includes: [],
        source: { kind: "ai", reason: "No suitable USDA record" },
        nutrition: {
          energyKcal: energy,
          proteinGrams: 5,
          carbohydrateGrams: 50,
          fatGrams: 2,
        },
      },
    ],
  };
}
async function setup(
  analyzer: PhotoAnalyzer,
  options: {
    usda?: UsdaAnalysisReader;
    rounds?: number;
    deadlineMs?: number;
  } = {},
) {
  const dir = await mkdtemp(path.join(tmpdir(), "photo-analysis-"));
  directories.push(dir);
  const db = openApplicationDatabase({
    databasePath: path.join(dir, "db.sqlite"),
    migrationsFolder: path.resolve("drizzle"),
  });
  databases.push(db);
  const client = db.getClient();
  const createdAt = "2026-09-05T03:59:00.000Z";
  const userId = client
    .insert(users)
    .values({ usernameNormalized: "photo.user", createdAt })
    .returning()
    .get().id;
  client
    .insert(userPreferences)
    .values({
      userId,
      timeZone: "America/New_York",
      displayUnits: "metric",
      createdAt,
      updatedAt: createdAt,
    })
    .run();
  const clock = { instant: new Date(createdAt) };
  const service = new PhotoAnalysisService(client, analyzer, {
    now: () => clock.instant,
    ...options,
  });
  services.push(service);
  const log = new FoodLogService(client, () => clock.instant);
  return { service, log, userId, clock, client };
}

test("a photo returns promptly, excludes pending nutrition, and auto-saves one entry on the captured date", async () => {
  let finish!: (value: unknown) => void;
  const { service, log, userId, clock } = await setup({
    analyze: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const started = service.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "initial-photo-1",
  });
  expect(started.status).toBe("active");
  expect(log.read(userId, "2026-09-04")?.entries).toHaveLength(0);
  clock.instant = new Date("2026-09-05T04:01:00.000Z");
  finish(estimate());
  await expect
    .poll(() => service.status(userId, started.id).status)
    .toBe("succeeded");
  expect(log.read(userId, "2026-09-04")?.entries).toMatchObject([
    {
      provider: "ai-photo",
      energyMilliKcal: 250000,
      proteinMilligrams: 5000,
      fiberMilligrams: null,
      localEventTime: "23:59:00",
    },
  ]);
  expect(log.read(userId, "2026-09-05")?.entries).toHaveLength(0);
});

test("successive AI corrections retain old totals while active and atomically replace the same entry", async () => {
  const completions: ((value: unknown) => void)[] = [];
  const contexts: unknown[] = [];
  const { service, log, userId } = await setup({
    analyze: (input) => {
      contexts.push(input);
      return new Promise((resolve) => completions.push(resolve));
    },
  });
  const meal = service.start(userId, {
    photo,
    foodLogDate: "2026-09-03",
    idempotencyKey: "plate-correction",
  });
  completions.shift()!(estimate());
  await expect
    .poll(() => service.status(userId, meal.id).status)
    .toBe("succeeded");
  const entryId = service.status(userId, meal.id).entryId!;
  for (const [index, correction] of [
    "It has butter",
    "Only half the rice",
  ].entries()) {
    service.correct(userId, entryId, {
      correction,
      idempotencyKey: `correction-${index}`,
    });
    expect(log.read(userId, "2026-09-03")?.entries).toMatchObject([
      { id: entryId, energyMilliKcal: index === 0 ? 250000 : 350000 },
    ]);
    expect(() =>
      service.correct(userId, entryId, {
        correction: "Another change",
        idempotencyKey: "conflicting-request",
      }),
    ).toThrow();
    completions.shift()!(estimate(index === 0 ? 350 : 200));
    await expect
      .poll(() => service.status(userId, meal.id).status)
      .toBe("succeeded");
  }
  expect(log.read(userId, "2026-09-03")?.entries).toMatchObject([
    { id: entryId, energyMilliKcal: 200000, localEventTime: "12:00:00" },
  ]);
  expect(contexts.at(-1)).toMatchObject({
    correction: "Only half the rice",
    previousCorrections: ["It has butter"],
    currentResult: { name: "Rice plate" },
  });
  expect(service.history(userId, meal.id)).toHaveLength(3);
});

test("cancel and retry ignore late results, deduplicate requests, and preserve correction nutrition", async () => {
  const completions: ((value: unknown) => void)[] = [];
  const { service, log, userId } = await setup({
    analyze: () => new Promise((resolve) => completions.push(resolve)),
  });
  const input = {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "cancel-initial",
  };
  const meal = service.start(userId, input);
  expect(service.start(userId, input).id).toBe(meal.id);
  service.cancel(userId, meal.id, meal.attemptId);
  const retried = service.retry(userId, meal.id, {
    idempotencyKey: "explicit-retry",
    attemptId: meal.attemptId,
  });
  expect(
    service.retry(userId, meal.id, {
      idempotencyKey: "explicit-retry",
      attemptId: meal.attemptId,
    }).attemptId,
  ).toBe(retried.attemptId);
  completions[0](estimate(999));
  completions[1](estimate(200));
  await expect
    .poll(() => service.status(userId, meal.id).status)
    .toBe("succeeded");
  const entryId = service.status(userId, meal.id).entryId!;
  const correction = service.correct(userId, entryId, {
    correction: "Add butter",
    idempotencyKey: "cancel-correction",
  });
  service.cancel(userId, meal.id, correction.attemptId);
  completions[2](estimate(600));
  await Promise.resolve();
  expect(log.read(userId, "2026-09-04")?.entries).toMatchObject([
    { id: entryId, energyMilliKcal: 200000 },
  ]);
  expect(service.status(userId, meal.id).status).toBe("canceled");
  expect(() => service.status(userId + 1, meal.id)).toThrow();
  expect(() => service.photo(userId + 1, meal.id)).toThrow();
  service.delete(userId, meal.id);
  expect(() => service.photo(userId, meal.id)).toThrow();
  expect(() => service.history(userId, meal.id)).toThrow();
  expect(log.read(userId, "2026-09-04")?.entries).toHaveLength(0);
});

test("a bounded attempt times out and a new server marks lost work interrupted without rerunning it", async () => {
  const { client, userId } = await setup({ analyze: async () => estimate() });
  const analyzer: PhotoAnalyzer = { analyze: () => new Promise(() => {}) };
  const timed = new PhotoAnalysisService(client, analyzer, { deadlineMs: 20 });
  services.push(timed);
  const first = timed.start(userId, {
    photo,
    foodLogDate: "2026-09-03",
    idempotencyKey: "deadline-photo",
  });
  await expect.poll(() => timed.status(userId, first.id).status).toBe("failed");
  expect(timed.status(userId, first.id).error).toContain("timed out");
  const running = timed.start(userId, {
    photo,
    foodLogDate: "2026-09-03",
    idempotencyKey: "interrupted-photo",
  });
  timed.shutdown();
  const restarted = new PhotoAnalysisService(client, analyzer);
  expect(restarted.status(userId, running.id).status).toBe("interrupted");
  expect(restarted.photo(userId, running.id).bytes).toEqual(photo.bytes);
});

function usdaFixture() {
  const record = {
    fdcId: 700,
    dataType: "Foundation",
    description: "Rice, cooked",
    foodNutrients: [
      { amount: 130, nutrient: { id: 1008, unitName: "kcal" } },
      { amount: 2.7, nutrient: { id: 1003, unitName: "g" } },
      { amount: 28, nutrient: { id: 1005, unitName: "g" } },
      { amount: 0.3, nutrient: { id: 1004, unitName: "g" } },
      { amount: 0, nutrient: { id: 2000, unitName: "g" } },
    ],
  };
  return new UsdaFoodDataCentralAdapter({
    apiKey: "fixture",
    fetchImplementation: async (_url, init) =>
      new Response(
        JSON.stringify(init?.method === "POST" ? { foods: [record] } : record),
      ),
  });
}

test("AI can revise USDA searches while authoritative records determine nutrition and the consumed fraction applies once", async () => {
  const { service, log, userId } = await setup(
    {
      analyze: async ({ usda }) => {
        await usda.search("rice raw", 1);
        await usda.search("rice cooked", 1);
        return {
          ...estimate(999),
          consumedFraction: 0.5,
          components: [
            {
              ...estimate().components[0],
              source: { kind: "usda", fdcId: "700" },
              nutrition: estimate(999).components[0].nutrition,
            },
          ],
        };
      },
    },
    { usda: usdaFixture() },
  );
  const meal = service.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "usda-backed-plate",
  });
  await expect
    .poll(() => service.status(userId, meal.id).status)
    .toBe("succeeded");
  expect(log.read(userId, "2026-09-04")?.entries).toMatchObject([
    {
      energyMilliKcal: 130000,
      proteinMilligrams: 2700,
      carbohydrateMilligrams: 28000,
      fatMilligrams: 300,
      fiberMilligrams: null,
      sugarMilligrams: 0,
    },
  ]);
  expect(service.history(userId, meal.id)[0].evidence).toContain(
    "Rice, cooked",
  );
});

test.each([
  [
    "unretrieved USDA identifier",
    () => ({
      ...estimate(),
      components: [
        { ...estimate().components[0], source: { kind: "usda", fdcId: "999" } },
      ],
    }),
  ],
  [
    "invalid unit",
    () => ({
      ...estimate(),
      components: [{ ...estimate().components[0], unit: "cups" }],
    }),
  ],
  ["negative calories", () => estimate(-1)],
  ["storage overflow", () => estimate(1000000)],
  [
    "duplicate components",
    () => ({
      ...estimate(),
      components: [estimate().components[0], estimate().components[0]],
    }),
  ],
  [
    "dish plus its ingredient",
    () => ({
      ...estimate(),
      components: [
        {
          ...estimate().components[0],
          id: "dish",
          name: "Rice dish",
          includes: ["rice"],
        },
        estimate().components[0],
      ],
    }),
  ],
  ["no usable result", () => ({ completed: true })],
] as const)(
  "%s fails visibly without changing totals",
  async (_name, invalid) => {
    const { service, log, userId } = await setup({
      analyze: async () => invalid(),
    });
    const meal = service.start(userId, {
      photo,
      foodLogDate: "2026-09-04",
      idempotencyKey: "invalid-result",
    });
    await expect
      .poll(() => service.status(userId, meal.id).status)
      .toBe("failed");
    expect(log.read(userId, "2026-09-04")?.entries).toHaveLength(0);
  },
);

test("invalid image data is rejected before accepting an analysis", async () => {
  const { service, userId } = await setup({ analyze: async () => estimate() });
  expect(() =>
    service.start(userId, {
      photo: {
        mimeType: "image/png",
        bytes: Buffer.from("this is not a photo"),
      },
      foodLogDate: "2026-09-04",
      idempotencyKey: "invalid-image",
    }),
  ).toThrow();
});

function piMessage(content: PiMessage["content"]): PiMessage {
  return {
    role: "assistant",
    content,
    api: "openai-responses",
    provider: "openai-codex",
    model: "gpt-5.6-luna",
    stopReason: "stop",
    timestamp: 1,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

test("Pi can use explicit estimates after a USDA outage and exposes only the USDA tools", async () => {
  let deliveredError = false;
  let toolNames: string[] = [];
  const analyzer = new PiPhotoAnalyzer(async (context) => {
    toolNames = context.tools?.map((tool) => tool.name) ?? [];
    const previous = context.messages.at(-1)!;
    if (previous.role === "toolResult") {
      deliveredError = previous.isError;
      return piMessage([{ type: "text", text: JSON.stringify(estimate()) }]);
    }
    return piMessage([
      {
        type: "toolCall",
        id: "search-one",
        name: "usda_search",
        arguments: { query: "rice", page: 1 },
      },
    ]);
  });
  const usda = new UsdaFoodDataCentralAdapter({
    apiKey: "fixture",
    fetchImplementation: async () => {
      throw new Error("Network unavailable");
    },
  });
  const { service, log, userId } = await setup(analyzer, { usda });
  const meal = service.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "pi-outage-result",
  });
  await expect
    .poll(() => service.status(userId, meal.id).status)
    .toBe("succeeded");
  expect(toolNames).toEqual(["usda_search", "usda_detail"]);
  expect(deliveredError).toBe(true);
  expect(log.read(userId, "2026-09-04")?.entries).toMatchObject([
    { energyMilliKcal: 250000 },
  ]);
});

test("processing blocks entry reads, edits, copies and deletion while other meals stay available", async () => {
  let finish!: (value: unknown) => void;
  const { service, client, userId } = await setup({
    analyze: () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  });
  const entries = new FoodEntryService(
    client,
    {
      getFood: async () => {
        throw new Error("Unused catalog");
      },
    },
    () => new Date("2026-09-05T03:59:00.000Z"),
  );
  const other = entries.logManual(userId, {
    name: "Other meal",
    energyKcal: "100",
    quantity: "1",
    foodLogDate: "2026-09-03",
    idempotencyKey: "other-meal",
  });
  const meal = service.start(userId, {
    photo,
    foodLogDate: "2026-09-03",
    idempotencyKey: "entry-lock-photo",
  });
  finish(estimate());
  await expect
    .poll(() => service.status(userId, meal.id).status)
    .toBe("succeeded");
  const entryId = service.status(userId, meal.id).entryId!;
  const before = entries.read(userId, entryId);
  service.correct(userId, entryId, {
    correction: "Butter",
    idempotencyKey: "lock-correction",
  });
  expect(() => entries.read(userId, entryId)).toThrow();
  expect(() =>
    entries.delete(userId, entryId, {
      foodLogDate: before.foodLogDate,
      expectedUpdatedAt: before.updatedAt,
    }),
  ).toThrow();
  expect(() =>
    entries.update(userId, entryId, {
      foodLogDate: before.foodLogDate,
      expectedUpdatedAt: before.updatedAt,
      quantity: "2",
      selectedMeasurementId: "plate",
      name: "Changed",
    }),
  ).toThrow();
  expect(() =>
    entries.copyToToday(userId, entryId, {
      foodLogDate: before.foodLogDate,
      idempotencyKey: `copy:${entryId}:locked-copy`,
    }),
  ).toThrow();
  expect(entries.read(userId, other.id).energyMilliKcal).toBe(100000);
});

test("USDA components can omit model arithmetic while the saved result still contains validated nutrition", async () => {
  const { service, userId } = await setup(
    {
      analyze: async ({ usda }) => {
        await usda.detail("700");
        return {
          ...estimate(),
          components: [
            {
              ...estimate().components[0],
              source: { kind: "usda", fdcId: "700" },
              nutrition: undefined,
            },
          ],
        };
      },
    },
    { usda: usdaFixture() },
  );
  const meal = service.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "derived-nutrition",
  });
  await expect
    .poll(() => service.status(userId, meal.id).status)
    .toBe("succeeded");
  expect(
    service.view(userId, meal.id).result?.components[0].nutrition,
  ).toMatchObject({ energyKcal: 260, proteinGrams: 5.4, fiberGrams: null });
});

test("failed corrections never erase successful USDA context or become applied correction instructions", async () => {
  const contexts: Parameters<PhotoAnalyzer["analyze"]>[0][] = [];
  const { service, userId } = await setup(
    {
      analyze: async (input) => {
        contexts.push(input);
        if (!input.currentResult) await input.usda.detail("700");
        if (input.correction === "abandoned") throw new Error("Unavailable");
        return {
          ...estimate(),
          name: input.correction ?? "Original rice",
          components: [
            {
              ...estimate().components[0],
              source: { kind: "usda", fdcId: "700" },
            },
          ],
        };
      },
    },
    { usda: usdaFixture() },
  );
  const meal = service.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "retained-reference",
  });
  await expect
    .poll(() => service.status(userId, meal.id).status)
    .toBe("succeeded");
  const entryId = service.status(userId, meal.id).entryId!;
  for (let i = 0; i < 4; i++) {
    service.correct(userId, entryId, {
      correction: "abandoned",
      idempotencyKey: `failed-context-${i}`,
    });
    await expect
      .poll(() => service.status(userId, meal.id).status)
      .toBe("failed");
    expect(service.view(userId, meal.id)).toMatchObject({
      result: { name: "Original rice" },
      energyMilliKcal: 260000,
    });
  }
  service.correct(userId, entryId, {
    correction: "Use the same weighed amount",
    idempotencyKey: "retained-reference-correction",
  });
  await expect
    .poll(() => service.status(userId, meal.id).status)
    .toBe("succeeded");
  expect(contexts.at(-1)).toMatchObject({
    previousCorrections: [],
    currentResult: { name: "Original rice" },
    evidence: [{ food: { providerFoodId: "700" } }],
  });
  expect(service.view(userId, meal.id).result?.name).toBe(
    "Use the same weighed amount",
  );
});

test("photo views use the current Food Entry name after a manual edit", async () => {
  const { service, client, userId } = await setup({
    analyze: async () => estimate(),
  });
  const meal = service.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "renamed-photo-meal",
  });
  await expect
    .poll(() => service.status(userId, meal.id).status)
    .toBe("succeeded");
  const entryId = service.status(userId, meal.id).entryId!;
  const entries = new FoodEntryService(
    client,
    {
      getFood: async () => {
        throw new Error("Unused");
      },
    },
    () => new Date("2026-09-05T03:59:00.000Z"),
  );
  const before = entries.read(userId, entryId);
  entries.update(userId, entryId, {
    foodLogDate: before.foodLogDate,
    expectedUpdatedAt: before.updatedAt,
    quantity: "1",
    selectedMeasurementId: "plate",
    name: "Dinner rice",
  });
  expect(service.view(userId, meal.id)).toMatchObject({
    name: "Dinner rice",
    result: { name: "Rice plate" },
  });
});

test("invalid dates, keys, ownership, and stale attempt actions cannot mutate meals", async () => {
  const { service, userId } = await setup({
    analyze: () => new Promise(() => {}),
  });
  const start = (key: string, date = "2026-09-04") =>
    service.start(userId, { photo, foodLogDate: date, idempotencyKey: key });
  for (const key of [
    "short",
    "a".repeat(129),
    "bad space key",
    "x;bad-request",
  ])
    expect(() => start(key)).toThrow();
  for (const date of ["invalid", "2026-02-30", "2026-09-05"])
    expect(() => start("invalid-date-request", date)).toThrow(
      "Invalid Food Log date",
    );
  expect(() => service.list(userId, "wrong")).toThrow("Invalid Food Log date");
  expect(() =>
    service.start(userId + 1, {
      photo,
      foodLogDate: "2026-09-04",
      idempotencyKey: "no-time-zone",
    }),
  ).toThrow("Invalid Food Log date");
  const meal = start("guarded-photo");
  expect(service.view(userId, meal.id)).toMatchObject({
    status: "active",
    stage: "Analyzing photo",
    energyMilliKcal: null,
    result: null,
    name: null,
  });
  expect(service.list(userId, "2026-09-04").map((item) => item.id)).toEqual([
    meal.id,
  ]);
  expect(service.list(userId + 1, "2026-09-04")).toEqual([]);
  expect(service.list(userId, "2026-09-03")).toEqual([]);
  expect(() => service.cancel(userId, meal.id, "stale")).toThrow(
    "This attempt has changed",
  );
  expect(() => service.delete(userId, meal.id)).toThrow(
    "Cancel the active analysis before deleting it",
  );
  expect(() =>
    service.retry(userId, meal.id, {
      attemptId: meal.attemptId,
      idempotencyKey: "active-retry",
    }),
  ).toThrow("This attempt cannot be retried");
  service.cancel(userId, meal.id, meal.attemptId);
  expect(service.status(userId, meal.id).error).toBe(
    "Analysis canceled. Retry when ready.",
  );
  expect(() =>
    service.retry(userId, meal.id, {
      attemptId: "stale",
      idempotencyKey: "stale-retry",
    }),
  ).toThrow("This attempt cannot be retried");
  expect(() =>
    service.retry(userId, meal.id, {
      attemptId: meal.attemptId,
      idempotencyKey: "bad key",
    }),
  ).toThrow();
  const other = start("other-owned-photo");
  expect(() =>
    service.retry(userId, meal.id, {
      attemptId: meal.attemptId,
      idempotencyKey: "other-owned-photo",
    }),
  ).toThrow("Request key belongs to another meal");
  service.cancel(userId, other.id, other.attemptId);
  service.cancel(userId, other.id, other.attemptId);
  service.delete(userId, other.id);
  expect(() => service.status(userId, other.id)).toThrow(
    "Photo meal unavailable",
  );
  expect(() => service.photo(userId, other.id)).toThrow(
    "Photo meal unavailable",
  );
});

test("completed corrections deduplicate per meal, validate text and keys, and preserve manual current context", async () => {
  const contexts: Parameters<PhotoAnalyzer["analyze"]>[0][] = [];
  const { service, userId, client } = await setup({
    analyze: async (input) => {
      contexts.push(input);
      return estimate(0);
    },
  });
  const meals = ["dedup-photo-one", "dedup-photo-two"].map((idempotencyKey) =>
    service.start(userId, { photo, foodLogDate: "2026-09-04", idempotencyKey }),
  );
  await expect
    .poll(() => service.status(userId, meals[1].id).status)
    .toBe("succeeded");
  const entryId = service.status(userId, meals[0].id).entryId!;
  expect(service.view(userId, meals[0].id).energyMilliKcal).toBe(0);
  expect(() =>
    service.retry(userId, meals[0].id, {
      attemptId: meals[0].attemptId,
      idempotencyKey: "completed-retry",
    }),
  ).toThrow("This attempt cannot be retried");
  for (const correction of [" ", "x".repeat(2001)])
    expect(() =>
      service.correct(userId, entryId, {
        correction,
        idempotencyKey: "invalid-correction",
      }),
    ).toThrow();
  expect(() =>
    service.correct(userId, entryId, {
      correction: "valid",
      idempotencyKey: "bad key",
    }),
  ).toThrow();
  expect(() =>
    service.correct(userId + 1, entryId, {
      correction: "valid",
      idempotencyKey: "foreign-correction",
    }),
  ).toThrow("Photo meal unavailable");
  expect(() =>
    service.correct(userId, entryId, {
      correction: "valid",
      idempotencyKey: "dedup-photo-two",
    }),
  ).toThrow("Request key belongs to another meal");
  const entries = new FoodEntryService(
    client,
    {
      getFood: async () => {
        throw new Error("Unused");
      },
    },
    () => new Date("2026-09-05T03:59:05.000Z"),
  );
  const before = entries.read(userId, entryId);
  const edited = entries.update(userId, entryId, {
    foodLogDate: before.foodLogDate,
    expectedUpdatedAt: before.updatedAt,
    quantity: "2",
    selectedMeasurementId: "plate",
    name: "Edited rice",
  });
  const correction = service.correct(userId, entryId, {
    correction: "  Add butter  ",
    idempotencyKey: "trimmed-correction",
  });
  expect(correction.stage).toBe("Analyzing photo");
  expect(
    service.correct(userId, entryId, {
      correction: "Add butter",
      idempotencyKey: "trimmed-correction",
    }).attemptId,
  ).toBe(correction.attemptId);
  expect(() =>
    service.correct(userId, entryId, {
      correction: "extra",
      idempotencyKey: "competing-correction",
    }),
  ).toThrow("Analysis is already processing");
  await expect
    .poll(() => service.status(userId, meals[0].id).status)
    .toBe("succeeded");
  expect(contexts.at(-1)).toMatchObject({
    correction: "Add butter",
    currentEntry: { editedName: "Edited rice", quantityMicrounits: 2000000 },
  });
  expect(entries.read(userId, entryId).updatedAt > edited.updatedAt).toBe(true);
  expect(
    service.correct(userId, entryId, {
      correction: "Add butter",
      idempotencyKey: "trimmed-correction",
    }).attemptId,
  ).toBe(correction.attemptId);
});

test("supported photo signatures and size limits are enforced before acceptance", async () => {
  const { service, userId } = await setup({ analyze: async () => estimate() });
  const jpeg = Buffer.concat([
    Buffer.from([255, 216, 255]),
    Buffer.alloc(7),
    Buffer.from([255, 217]),
  ]);
  const webp = Buffer.from("RIFF\x04\x00\x00\x00WEBP");
  const maximum = Buffer.alloc(8388608);
  photo.bytes.copy(maximum);
  for (const [index, image] of [
    { mimeType: "image/jpeg", bytes: jpeg },
    { mimeType: "image/webp", bytes: webp },
    { ...photo, bytes: maximum },
  ].entries()) {
    const meal = service.start(userId, {
      photo: image,
      foodLogDate: "2026-09-04",
      idempotencyKey: `supported-image-${index}`,
    });
    expect(service.photo(userId, meal.id).mimeType).toBe(image.mimeType);
    expect(service.photo(userId, meal.id).bytes.equals(image.bytes)).toBe(true);
  }
  const invalid = [
    { ...photo, bytes: Buffer.alloc(11) },
    { ...photo, bytes: Buffer.alloc(8388609) },
    { mimeType: "image/gif", bytes: photo.bytes },
    {
      mimeType: "image/jpeg",
      bytes: Buffer.concat([Buffer.alloc(10), Buffer.from([255, 217])]),
    },
    {
      mimeType: "image/jpeg",
      bytes: Buffer.concat([Buffer.from([255, 216, 255]), Buffer.alloc(9)]),
    },
    { mimeType: "image/webp", bytes: Buffer.from("RIFFxxxxxxxx") },
    { mimeType: "image/webp", bytes: Buffer.from("xxxx1234WEBP") },
  ];
  for (const [index, image] of invalid.entries())
    expect(() =>
      service.start(userId, {
        photo: image,
        foodLogDate: "2026-09-04",
        idempotencyKey: `unsupported-image-${index}`,
      }),
    ).toThrow(
      index < 2
        ? "Choose a photo up to 8 MB"
        : "Choose a JPEG, PNG, or WebP photo",
    );
});

test("USDA budgets permit the configured final round and forbid additional searches and details", async () => {
  const { service, userId } = await setup(
    {
      analyze: async ({ usda }) => {
        for (let i = 0; i < 3; i++)
          expect(await usda.search("rice", 1)).toHaveLength(1);
        await expect(usda.search("rice", 1)).rejects.toThrow(
          "USDA unavailable or search limit reached",
        );
        for (let i = 0; i < 6; i++)
          expect((await usda.detail("700")).food.providerFoodId).toBe("700");
        await expect(usda.detail("700")).rejects.toThrow(
          "USDA detail limit reached or unavailable",
        );
        return estimate();
      },
    },
    { usda: usdaFixture() },
  );
  const meal = service.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "bounded-usda-tools",
  });
  await expect
    .poll(() => service.status(userId, meal.id).status)
    .toBe("succeeded");
  expect(service.history(userId, meal.id)[0]).toMatchObject({
    stage: "Preparing result",
  });
  expect(
    JSON.parse(service.history(userId, meal.id)[0].evidence),
  ).toMatchObject([{ food: { providerFoodId: "700" } }]);
  const configured = new PhotoAnalysisService(
    databases.at(-1)!.getClient(),
    {
      analyze: async ({ usda }) => {
        expect(await usda.search("rice", 1)).toHaveLength(1);
        await expect(usda.search("rice", 1)).rejects.toThrow(
          "search limit reached",
        );
        return estimate();
      },
    },
    { usda: usdaFixture(), rounds: 1 },
  );
  services.push(configured);
  const limited = configured.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "custom-tool-budget",
  });
  await expect
    .poll(() => configured.status(userId, limited.id).status)
    .toBe("succeeded");
});

test("cancellation aborts pending USDA work and rejects late evidence without revising the terminal state", async () => {
  const evidence = await usdaFixture().getEvidence(
    "700",
    new AbortController().signal,
  );
  let finish!: (items: (typeof evidence)[]) => void;
  let input!: Parameters<PhotoAnalyzer["analyze"]>[0];
  const { service, userId } = await setup(
    {
      analyze: async (context) => {
        input = context;
        await context.usda.search("rice", 1);
        return estimate();
      },
    },
    {
      usda: {
        searchEvidence: () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
        getEvidence: async () => evidence,
      },
    },
  );
  const meal = service.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "cancel-usda-work",
  });
  expect(service.status(userId, meal.id).stage).toBe("Consulting USDA");
  service.cancel(userId, meal.id, meal.attemptId);
  finish([evidence]);
  await Promise.resolve();
  expect(input.signal.aborted).toBe(true);
  await expect(input.usda.search("rice", 1)).rejects.toThrow();
  await expect(input.usda.detail("700")).rejects.toThrow();
  expect(service.history(userId, meal.id)[0].evidence).toBe("[]");
  expect(service.status(userId, meal.id).status).toBe("canceled");
});

test("startup interrupts persisted active work, and late CPU-bound results cannot pass the deadline", async () => {
  const { service, userId, client } = await setup({
    analyze: () => new Promise(() => {}),
  });
  const meal = service.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "lost-on-restart",
  });
  const restarted = new PhotoAnalysisService(client, {
    analyze: async () => estimate(),
  });
  services.push(restarted);
  expect(restarted.status(userId, meal.id)).toMatchObject({
    status: "interrupted",
    error: "Server restarted. Retry this analysis.",
  });
  const slow = new PhotoAnalysisService(
    client,
    {
      analyze: async () => {
        vi.spyOn(performance, "now").mockReturnValueOnce(Infinity);
        return estimate();
      },
    },
    { deadlineMs: 20000 },
  );
  services.push(slow);
  const late = slow.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "cpu-bound-timeout",
  });
  await expect.poll(() => slow.status(userId, late.id).status).toBe("failed");
  expect(slow.view(userId, late.id)).toMatchObject({
    entryId: null,
    error: "Analysis timed out. Retry when ready.",
  });
  vi.restoreAllMocks();
});

test("Pi forwards the photo, successful context, complete USDA evidence and assistant tool metadata", async () => {
  let calls = 0;
  const contexts: unknown[] = [];
  const checkToolContext = (
    context: import("../app/photo-analysis/pi.server").PiContext,
  ) => {
    const last = context.messages.at(-1)!;
    expect(last).toMatchObject({
      role: "toolResult",
      toolCallId: "detail-one",
      toolName: "usda_detail",
      isError: false,
    });
    expect(JSON.stringify(last.content)).toContain("fdcId");
    expect(context.messages.at(-2)).toMatchObject({
      role: "assistant",
      content: [
        { type: "thinking", thinking: "provider metadata" },
        { type: "toolCall", id: "detail-one" },
      ],
    });
  };
  const analyzer = new PiPhotoAnalyzer(async (context) => {
    contexts.push(structuredClone(context.messages));
    const last = context.messages.at(-1)!;
    if (last.role === "toolResult") {
      checkToolContext(context);
      const json = JSON.stringify(estimate());
      return piMessage([
        { type: "thinking", thinking: "private reasoning" },
        { type: "text", text: json.slice(0, 20) },
        { type: "text", text: json.slice(20) },
      ]);
    }
    calls++;
    return piMessage([
      { type: "thinking", thinking: "provider metadata" },
      {
        type: "toolCall",
        id: "detail-one",
        name: "usda_detail",
        arguments: { id: "700" },
      },
    ]);
  });
  const { service, userId } = await setup(analyzer, { usda: usdaFixture() });
  const meal = service.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "pi-complete-context",
  });
  await expect
    .poll(() => service.status(userId, meal.id).status)
    .toBe("succeeded");
  expect(calls).toBe(1);
  expect(contexts[0]).toMatchObject([
    {
      role: "user",
      content: [
        {
          type: "image",
          data: photo.bytes.toString("base64"),
          mimeType: "image/png",
        },
        {
          type: "text",
          text: JSON.stringify({ previousCorrections: [], evidence: [] }),
        },
      ],
    },
  ]);
  expect(JSON.stringify(service.history(userId, meal.id))).not.toContain(
    "private reasoning",
  );
});

test.each([
  ["unsupported tool", "exec", { command: "touch forbidden" }],
  ["invalid search", "usda_search", { query: "x", page: 1 }],
  ["oversized query", "usda_search", { query: "x".repeat(101), page: 1 }],
  ["invalid page", "usda_search", { query: "rice", page: 0 }],
  ["unbounded page", "usda_search", { query: "rice", page: 4 }],
  ["invalid detail", "usda_detail", { id: "0" }],
  ["prefixed detail", "usda_detail", { id: "x700" }],
  ["suffixed detail", "usda_detail", { id: "700x" }],
] as const)(
  "Pi reports %s safely and allows an explicit estimate",
  async (_label, name, args) => {
    let consulted = false;
    const checkError = (
      last: import("../app/photo-analysis/pi.server").PiContext["messages"][number],
    ) => {
      expect(last).toHaveProperty("isError", true);
      expect(last.content).toEqual([
        {
          type: "text",
          text: JSON.stringify({
            error:
              "USDA tool unavailable, invalid arguments, or limit reached. Use explicit estimates with reasons if a usable result is possible.",
          }),
        },
      ]);
    };
    const analyzer = new PiPhotoAnalyzer(async (context) => {
      const last = context.messages.at(-1)!;
      if (last.role === "toolResult") {
        checkError(last);
        return piMessage([{ type: "text", text: JSON.stringify(estimate()) }]);
      }
      return piMessage([
        { type: "toolCall", id: "invalid-tool", name, arguments: args },
      ]);
    });
    const { service, userId } = await setup(analyzer, {
      usda: {
        searchEvidence: async () => {
          consulted = true;
          return [];
        },
        getEvidence: async () => {
          consulted = true;
          throw new Error("Unexpected");
        },
      },
    });
    const meal = service.start(userId, {
      photo,
      foodLogDate: "2026-09-04",
      idempotencyKey: "invalid-pi-tool",
    });
    await expect
      .poll(() => service.status(userId, meal.id).status)
      .toBe("succeeded");
    expect(consulted).toBe(false);
  },
);

test.each(["error", "aborted"] as const)(
  "Pi %s completion cannot save even when its text looks valid",
  async (stopReason) => {
    const { service, userId } = await setup(
      new PiPhotoAnalyzer(async () => ({
        ...piMessage([{ type: "text", text: JSON.stringify(estimate()) }]),
        stopReason,
      })),
    );
    const meal = service.start(userId, {
      photo,
      foodLogDate: "2026-09-04",
      idempotencyKey: "bad-pi-stop-reason",
    });
    await expect
      .poll(() => service.status(userId, meal.id).status)
      .toBe("failed");
    expect(service.view(userId, meal.id).entryId).toBeNull();
  },
);

test("Pi bounds model turns, tools per turn, final output and accumulated evidence", async () => {
  let turns = 0;
  const call = {
    type: "toolCall" as const,
    id: "search",
    name: "usda_search",
    arguments: { query: "rice", page: 1 },
  };
  for (const [index, complete] of [
    async () => {
      turns++;
      return piMessage([call]);
    },
    async () => piMessage(Array.from({ length: 7 }, () => call)),
    async () =>
      piMessage([
        {
          type: "text" as const,
          text: JSON.stringify(estimate()) + " ".repeat(50000),
        },
      ]),
  ].entries()) {
    const { service, userId } = await setup(new PiPhotoAnalyzer(complete));
    const meal = service.start(userId, {
      photo,
      foodLogDate: "2026-09-04",
      idempotencyKey: `pi-budget-${index}`,
    });
    await expect
      .poll(() => service.status(userId, meal.id).status)
      .toBe("failed");
  }
  expect(turns).toBe(10);
  const evidence = await usdaFixture().getEvidence(
    "700",
    new AbortController().signal,
  );
  let modelCalls = 0;
  const { service, userId } = await setup(
    new PiPhotoAnalyzer(async () => {
      modelCalls++;
      return piMessage([call]);
    }),
    {
      usda: {
        searchEvidence: async () => [
          { ...evidence, record: { padding: "x".repeat(510000) } },
        ],
        getEvidence: async () => evidence,
      },
    },
  );
  const meal = service.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "pi-context-budget",
  });
  await expect
    .poll(() => service.status(userId, meal.id).status)
    .toBe("failed");
  expect(modelCalls).toBe(1);
});

test("the maximum Pi tool batch and final output size still allow a usable result", async () => {
  let calls = 0;
  const json = JSON.stringify(estimate());
  const { service, userId } = await setup(
    new PiPhotoAnalyzer(async (context) => {
      calls++;
      if (context.messages.at(-1)?.role === "toolResult")
        return piMessage([{ type: "text", text: json.padEnd(50000) }]);
      return piMessage(
        Array.from({ length: 6 }, (_, index) => ({
          type: "toolCall",
          id: `detail-${index}`,
          name: "usda_detail",
          arguments: { id: "700" },
        })),
      );
    }),
    { usda: usdaFixture() },
  );
  const meal = service.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "pi-budget-boundary",
  });
  await expect
    .poll(() => service.status(userId, meal.id).status)
    .toBe("succeeded");
  expect(calls).toBe(2);
});

test("missing USDA nutrients require explicit supplements and cannot be overridden", async () => {
  const evidence = await usdaFixture().getEvidence(
    "700",
    new AbortController().signal,
  );
  const required = [
    "energyKcal",
    "proteinGrams",
    "carbohydrateGrams",
    "fatGrams",
  ] as const;
  const keys = [
    "energyMilliKcal",
    "proteinMilligrams",
    "carbohydrateMilligrams",
    "fatMilligrams",
  ] as const;
  for (const [index, nutrient] of required.entries()) {
    const missing = structuredClone(evidence);
    missing.food.nutritionPerAuthoritativeBase[keys[index]] = null;
    const reader = {
      searchEvidence: async () => [missing],
      getEvidence: async () => missing,
    };
    for (const supplement of [false, true]) {
      const { service, userId, log } = await setup(
        {
          analyze: async ({ usda }) => {
            await usda.detail("700");
            return {
              ...estimate(),
              components: [
                {
                  ...estimate().components[0],
                  source: { kind: "usda", fdcId: "700" },
                  supplements: supplement
                    ? [
                        {
                          nutrient,
                          amount: 10,
                          reason: "Reference omits this nutrient",
                        },
                      ]
                    : [],
                },
              ],
            };
          },
        },
        { usda: reader },
      );
      const meal = service.start(userId, {
        photo,
        foodLogDate: "2026-09-04",
        idempotencyKey: `nutrient-supplement-${index}-${supplement}`,
      });
      await expect
        .poll(() => service.status(userId, meal.id).status)
        .toBe(supplement ? "succeeded" : "failed");
      expect(log.read(userId, "2026-09-04")?.entries[0]?.[keys[index]]).toBe(
        supplement ? 10000 : undefined,
      );
    }
  }
  const { service, userId } = await setup(
    {
      analyze: async ({ usda }) => {
        await usda.detail("700");
        return {
          ...estimate(),
          components: [
            {
              ...estimate().components[0],
              source: { kind: "usda", fdcId: "700" },
              supplements: [
                { nutrient: "energyKcal", amount: 999, reason: "Override" },
              ],
            },
          ],
        };
      },
    },
    { usda: usdaFixture() },
  );
  const meal = service.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "forbidden-usda-override",
  });
  await expect
    .poll(() => service.status(userId, meal.id).status)
    .toBe("failed");
});

test("mixed component totals retain unknown nutrients and reject duplicate names, invalid USDA units and aggregate overflow", async () => {
  const base = estimate().components[0];
  for (const [index, result, status] of [
    [
      {
        ...estimate(),
        components: [
          base,
          {
            ...base,
            id: "other",
            name: "Vegetable",
            nutrition: {
              ...base.nutrition,
              fiberGrams: 2,
              sugarGrams: 0,
              sodiumMilligrams: 50,
            },
          },
        ],
      },
      "succeeded",
    ],
    [
      {
        ...estimate(),
        components: [base, { ...base, id: "other", name: "COOKED RICE" }],
      },
      "failed",
    ],
    [{ ...estimate(), consumedFraction: 0.00000001 }, "failed"],
    [
      { ...estimate(), components: [{ ...base, nutrition: undefined }] },
      "failed",
    ],
    [
      {
        ...estimate(),
        components: [
          { ...base, unit: "ml", source: { kind: "usda", fdcId: "700" } },
        ],
      },
      "failed",
    ],
    [
      {
        ...estimate(),
        components: [
          { ...base, nutrition: { ...base.nutrition, energyKcal: 600000 } },
          {
            ...base,
            id: "second",
            name: "Second rice",
            nutrition: { ...base.nutrition, energyKcal: 600000 },
          },
        ],
      },
      "failed",
    ],
  ].map(([result, status], index) => [index, result, status] as const)) {
    const { service, userId, log } = await setup(
      {
        analyze: async ({ usda }) => {
          await usda.detail("700");
          return result;
        },
      },
      { usda: usdaFixture() },
    );
    const meal = service.start(userId, {
      photo,
      foodLogDate: "2026-09-04",
      idempotencyKey: `mixed-validation-${index}`,
    });
    await expect
      .poll(() => service.status(userId, meal.id).status)
      .toBe(status);
    expect(log.read(userId, "2026-09-04")?.entries).toMatchObject(
      status === "succeeded"
        ? [
            {
              energyMilliKcal: 500000,
              proteinMilligrams: 10000,
              carbohydrateMilligrams: 100000,
              fatMilligrams: 4000,
              fiberMilligrams: null,
              sugarMilligrams: null,
              sodiumMilligrams: null,
            },
          ]
        : [],
    );
  }
});

test("USDA context overflow retains only the previously accepted evidence for an explicit fallback", async () => {
  const evidence = await usdaFixture().getEvidence(
    "700",
    new AbortController().signal,
  );
  const oversized = {
    ...evidence,
    food: { ...evidence.food, providerFoodId: "701" },
    record: { padding: "x".repeat(750000) },
  };
  const { service, userId } = await setup(
    {
      analyze: async ({ usda }) => {
        await usda.detail("700");
        await expect(usda.search("large result", 1)).rejects.toThrow(
          "USDA context limit reached",
        );
        return estimate();
      },
    },
    {
      usda: {
        getEvidence: async () => evidence,
        searchEvidence: async () => [oversized],
      },
    },
  );
  const meal = service.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "evidence-overflow",
  });
  await expect
    .poll(() => service.status(userId, meal.id).status)
    .toBe("succeeded");
  expect(service.history(userId, meal.id)[0].evidence).toBe(
    JSON.stringify([evidence]),
  );
});

test("explicit retry can reuse complete evidence retrieved before an initial failure", async () => {
  let attempts = 0;
  const { service, userId } = await setup(
    {
      analyze: async ({ usda, evidence }) => {
        if (++attempts === 1) {
          await usda.detail("700");
          throw new Error("Provider interrupted");
        }
        expect(evidence.map((item) => item.food.providerFoodId)).toEqual([
          "700",
        ]);
        return {
          ...estimate(),
          components: [
            {
              ...estimate().components[0],
              source: { kind: "usda", fdcId: "700" },
            },
          ],
        };
      },
    },
    { usda: usdaFixture() },
  );
  const meal = service.start(userId, {
    photo,
    foodLogDate: "2026-09-04",
    idempotencyKey: "retry-retained-evidence",
  });
  await expect
    .poll(() => service.status(userId, meal.id).status)
    .toBe("failed");
  service.retry(userId, meal.id, {
    attemptId: meal.attemptId,
    idempotencyKey: "retry-without-new-lookup",
  });
  await expect
    .poll(() => service.status(userId, meal.id).status)
    .toBe("succeeded");
  expect(service.view(userId, meal.id).energyMilliKcal).toBe(260000);
});
