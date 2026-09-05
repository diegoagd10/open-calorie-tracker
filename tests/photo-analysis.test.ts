import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, test } from "vitest";
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
import { UsdaFoodDataCentralAdapter } from "../app/catalog/usda.server";
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
  options: { usda?: UsdaFoodDataCentralAdapter } = {},
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
  const { service, userId } = await setup({ analyze: async ({ usda }) => {
    await usda.detail("700");
    return { ...estimate(), components: [{ ...estimate().components[0], source: { kind: "usda", fdcId: "700" }, nutrition: undefined }] };
  } }, { usda: usdaFixture() });
  const meal = service.start(userId, { photo, foodLogDate: "2026-09-04", idempotencyKey: "derived-nutrition" });
  await expect.poll(() => service.status(userId, meal.id).status).toBe("succeeded");
  expect(service.view(userId, meal.id).result?.components[0].nutrition).toMatchObject({ energyKcal: 260, proteinGrams: 5.4, fiberGrams: null });
});
