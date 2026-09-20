import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

import { openApplicationDatabase, type ApplicationDatabase } from "../app/database/database.server";
import { createDatabaseApplicationMetadata } from "../app/database/application-metadata.server";
import {
  ModelDiscoveryError,
  PhotoAnalysisAttemptConfigurationUnavailableError,
  PhotoAnalysisConfigurationInputError,
  PhotoAnalysisConfigurationService,
  type PhotoAnalysisModelDiscovery,
} from "../app/photo-analysis/configuration.server";

const credentials = {
  geminiKey: "gemini-private-key",
  typeSafeKey: "typesafe-private-key",
};
let directory: string;
let database: ApplicationDatabase;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "photo-configuration-"));
  database = openApplicationDatabase({
    databasePath: path.join(directory, "application.sqlite"),
    migrationsFolder: path.resolve("drizzle"),
  });
});

afterEach(async () => {
  database.close();
  await rm(directory, { force: true, recursive: true });
});

test("discovers supported provider models and derives uncalibrated defaults without exposing credentials", async () => {
  const discoverGemini = vi.fn(async () => [
      { id: "gemini-3.1-flash-lite", displayName: "Gemini 3.1 Flash-Lite", methods: ["generateContent"] },
      { id: "gemini-3.1-flash-lite-preview", displayName: "Preview", methods: ["generateContent"] },
      { id: "gemini-3.1-flash-image", displayName: "Image generator", methods: ["generateContent"] },
      { id: "gemini-unknown-stable", displayName: "Unknown", methods: ["generateContent"] },
      { id: "gemini-3.5-flash", displayName: "Gemini 3.5 Flash", methods: ["embedContent"] },
    ]);
  const discoverJev = vi.fn(async () => [
      { id: "jev", effectiveId: "jev-1.13.0" },
      { id: "jev-1.13.0", effectiveId: "jev-1.13.0" },
      { id: "moving-alias", effectiveId: "not-a-concrete-jev-version" },
    ]);
  const discovery: PhotoAnalysisModelDiscovery = { discoverGemini, discoverJev };
  const service = new PhotoAnalysisConfigurationService(
    createDatabaseApplicationMetadata(database.getClient()),
    { read: async () => credentials },
    discovery,
  );

  const settings = await service.readSettings();

  expect(settings).toEqual({
    configuration: {
      geminiModel: "gemini-3.1-flash-lite",
      jevModel: "jev-1.13.0",
      categoryConfidenceThreshold: 0,
      productConfidenceThreshold: 0,
      calibrated: false,
    },
    gemini: {
      state: "available",
      models: [{ id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite", lowLatency: true }],
    },
    jev: {
      state: "available",
      models: [{ id: "jev-1.13.0", label: "Jev 1.13.0" }],
    },
    profiles: {},
    ready: true,
  });
  expect(discoverGemini).toHaveBeenCalledWith(credentials.geminiKey, expect.any(AbortSignal));
  expect(discoverJev).toHaveBeenCalledWith(credentials.typeSafeKey, expect.any(AbortSignal));
  expect(JSON.stringify(settings)).not.toContain(credentials.geminiKey);
  expect(JSON.stringify(settings)).not.toContain(credentials.typeSafeKey);
});

test("reports missing credentials before discovery and rejects configuration writes", async () => {
  const discovery: PhotoAnalysisModelDiscovery = {
    discoverGemini: vi.fn(async () => []),
    discoverJev: vi.fn(async () => []),
  };
  const service = new PhotoAnalysisConfigurationService(
    createDatabaseApplicationMetadata(database.getClient()),
    { read: async () => undefined },
    discovery,
  );
  expect(await service.readSettings()).toMatchObject({
    gemini: { state: "unconfigured" }, jev: { state: "unconfigured" }, ready: false,
    reason: "Configure both provider credentials before selecting models.",
  });
  await expect(service.save({
    geminiModel: "gemini-3.1-flash-lite", jevModel: "jev-1.13.0",
    categoryConfidenceThreshold: 0, productConfidenceThreshold: 0,
  })).rejects.toMatchObject({
    fieldErrors: {
      geminiModel: "Configure provider credentials before selecting models.",
      jevModel: "Configure provider credentials before selecting models.",
    },
  });
  expect(discovery.discoverGemini).not.toHaveBeenCalled();
});

test("distinguishes one or both unavailable default selections without choosing replacements", async () => {
  let geminiAvailable = false;
  let jevAvailable = false;
  const service = new PhotoAnalysisConfigurationService(
    createDatabaseApplicationMetadata(database.getClient()),
    { read: async () => credentials },
    {
      discoverGemini: async () => geminiAvailable
        ? [{ id: "gemini-3.1-flash-lite", displayName: "Gemini", methods: ["generateContent"] }]
        : [{ id: "gemini-3.5-flash", displayName: "Gemini", methods: ["generateContent"] }],
      discoverJev: async () => jevAvailable
        ? [{ id: "jev-1.13.0", effectiveId: "jev-1.13.0" }]
        : [{ id: "jev-1.14.0", effectiveId: "jev-1.14.0" }],
    },
  );
  expect((await service.readSettings()).reason).toBe("The selected Gemini and Jev models are unavailable.");
  jevAvailable = true;
  expect((await service.readSettings()).reason).toBe("The selected Gemini model is unavailable.");
  geminiAvailable = true;
  const ready = await service.readSettings();
  expect(ready.ready).toBe(true);
  expect("reason" in ready).toBe(false);
});

test("validates and atomically stores model-specific confidence profiles", async () => {
  const jevModels = [
    { id: "jev-1.13.0", effectiveId: "jev-1.13.0" },
    { id: "jev-1.14.0", effectiveId: "jev-1.14.0" },
  ];
  const discovery: PhotoAnalysisModelDiscovery = {
    discoverGemini: async () => [
      { id: "gemini-3.1-flash-lite", displayName: "Gemini 3.1 Flash-Lite", methods: ["generateContent"] },
      { id: "gemini-3.5-flash", displayName: "Gemini 3.5 Flash", methods: ["generateContent"] },
    ],
    discoverJev: async () => jevModels,
  };
  const service = new PhotoAnalysisConfigurationService(
    createDatabaseApplicationMetadata(database.getClient()),
    { read: async () => credentials },
    discovery,
    () => new Date("2026-09-19T20:00:00.000Z"),
  );

  await service.save({
    geminiModel: "gemini-3.5-flash",
    jevModel: "jev-1.13.0",
    categoryConfidenceThreshold: 0.35,
    productConfidenceThreshold: 0.6,
  });
  await service.save({
    geminiModel: "gemini-3.5-flash",
    jevModel: "jev-1.14.0",
    categoryConfidenceThreshold: 0,
    productConfidenceThreshold: 0,
  });
  await service.save({
    geminiModel: "gemini-3.1-flash-lite",
    jevModel: "jev-1.13.0",
    categoryConfidenceThreshold: 0.35,
    productConfidenceThreshold: 0.6,
  });

  expect(await service.readSettings()).toMatchObject({
    configuration: {
      geminiModel: "gemini-3.1-flash-lite",
      jevModel: "jev-1.13.0",
      categoryConfidenceThreshold: 0.35,
      productConfidenceThreshold: 0.6,
      calibrated: true,
    },
    profiles: {
      "jev-1.13.0": { categoryConfidenceThreshold: 0.35, productConfidenceThreshold: 0.6, calibrated: true },
      "jev-1.14.0": { categoryConfidenceThreshold: 0, productConfidenceThreshold: 0, calibrated: true },
    },
    ready: true,
  });
});

test("rejects free-text models and invalid thresholds without changing the saved configuration", async () => {
  const discovery: PhotoAnalysisModelDiscovery = {
    discoverGemini: async () => [
      { id: "gemini-3.1-flash-lite", displayName: "Gemini", methods: ["generateContent"] },
    ],
    discoverJev: async () => [{ id: "jev-1.13.0", effectiveId: "jev-1.13.0" }],
  };
  const service = new PhotoAnalysisConfigurationService(
    createDatabaseApplicationMetadata(database.getClient()),
    { read: async () => credentials },
    discovery,
  );

  const failure = await service.save({
    geminiModel: "typed-by-an-attacker",
    jevModel: "jev-1.13.0",
    categoryConfidenceThreshold: -0.1,
    productConfidenceThreshold: 1.1,
  }).catch((error: unknown) => error);

  expect(failure).toBeInstanceOf(PhotoAnalysisConfigurationInputError);
  expect(failure).toMatchObject({
    fieldErrors: {
      geminiModel: "Choose an available supported Gemini model.",
      categoryConfidenceThreshold: "Enter a value from 0.0 through 1.0.",
      productConfidenceThreshold: "Enter a value from 0.0 through 1.0.",
    },
  });
  expect((await service.readSettings()).configuration).toMatchObject({
    geminiModel: "gemini-3.1-flash-lite",
    jevModel: "jev-1.13.0",
    calibrated: false,
  });
});

test("retains an unavailable saved selection instead of silently switching models", async () => {
  let available = true;
  const discovery: PhotoAnalysisModelDiscovery = {
    discoverGemini: async () => [
      { id: "gemini-3.1-flash-lite", displayName: "Gemini", methods: ["generateContent"] },
    ],
    discoverJev: async () => available
      ? [{ id: "jev-1.13.0", effectiveId: "jev-1.13.0" }]
      : [{ id: "jev-1.14.0", effectiveId: "jev-1.14.0" }],
  };
  const service = new PhotoAnalysisConfigurationService(
    createDatabaseApplicationMetadata(database.getClient()),
    { read: async () => credentials },
    discovery,
  );
  await service.save({
    geminiModel: "gemini-3.1-flash-lite",
    jevModel: "jev-1.13.0",
    categoryConfidenceThreshold: 0.2,
    productConfidenceThreshold: 0.4,
  });

  available = false;
  expect(await service.readSettings()).toMatchObject({
    configuration: { jevModel: "jev-1.13.0", categoryConfidenceThreshold: 0.2, productConfidenceThreshold: 0.4 },
    jev: { state: "available", models: [{ id: "jev-1.14.0" }] },
    ready: false,
    reason: "The selected Jev model is unavailable.",
  });
});

test("reports permanent and transient discovery failures while preserving the prior configuration", async () => {
  let failure: "none" | "permanent" | "transient" | "unknown" = "none";
  const discovery: PhotoAnalysisModelDiscovery = {
    discoverGemini: async () => {
      if (failure === "permanent") throw new ModelDiscoveryError("permanent-incompatibility");
      if (failure === "unknown") throw new Error("unknown provider failure");
      return [{ id: "gemini-3.1-flash-lite", displayName: "Gemini", methods: ["generateContent"] }];
    },
    discoverJev: async () => {
      if (failure === "transient") throw new ModelDiscoveryError("transient-availability");
      return [{ id: "jev-1.13.0", effectiveId: "jev-1.13.0" }];
    },
  };
  const service = new PhotoAnalysisConfigurationService(createDatabaseApplicationMetadata(database.getClient()), { read: async () => credentials }, discovery);
  await service.save({
    geminiModel: "gemini-3.1-flash-lite",
    jevModel: "jev-1.13.0",
    categoryConfidenceThreshold: 0.25,
    productConfidenceThreshold: 0.5,
  });

  failure = "permanent";
  expect(await service.readSettings()).toMatchObject({
    configuration: { geminiModel: "gemini-3.1-flash-lite", categoryConfidenceThreshold: 0.25 },
    gemini: { state: "incompatible", models: [] },
    ready: false,
  });

  failure = "transient";
  expect(await service.readSettings()).toMatchObject({
    configuration: { jevModel: "jev-1.13.0", productConfidenceThreshold: 0.5 },
    jev: { state: "transient-error", models: [] },
    ready: false,
  });

  failure = "unknown";
  expect(await service.readSettings()).toMatchObject({
    gemini: { state: "transient-error", models: [] }, ready: false,
  });
});

test("captures an attempt configuration without retaining mutable credential or profile state", async () => {
  let currentCredentials = credentials;
  const service = new PhotoAnalysisConfigurationService(
    createDatabaseApplicationMetadata(database.getClient()),
    { read: async () => currentCredentials },
    {
      discoverGemini: async () => [
        { id: "gemini-3.1-flash-lite", displayName: "Gemini", methods: ["generateContent"] },
      ],
      discoverJev: async () => [
        { id: "jev-1.13.0", effectiveId: "jev-1.13.0" },
      ],
    },
  );
  await service.save({
    geminiModel: "gemini-3.1-flash-lite",
    jevModel: "jev-1.13.0",
    categoryConfidenceThreshold: 0.25,
    productConfidenceThreshold: 0.6,
  });

  const captured = await service.captureAttemptConfiguration();
  currentCredentials = {
    geminiKey: "replacement-gemini-key",
    typeSafeKey: "replacement-typesafe-key",
  };
  await service.save({
    geminiModel: "gemini-3.1-flash-lite",
    jevModel: "jev-1.13.0",
    categoryConfidenceThreshold: 0.8,
    productConfidenceThreshold: 0.9,
  });

  expect(captured).toEqual({
    geminiKey: "gemini-private-key",
    typeSafeKey: "typesafe-private-key",
    geminiModel: "gemini-3.1-flash-lite",
    jevModel: "jev-1.13.0",
    categoryConfidenceThreshold: 0.25,
    productConfidenceThreshold: 0.6,
  });
  expect(await service.captureAttemptConfiguration()).toMatchObject({
    geminiKey: "replacement-gemini-key",
    categoryConfidenceThreshold: 0.8,
    productConfidenceThreshold: 0.9,
  });
});

test("rechecks model availability and retries capture when configuration changes concurrently", async () => {
  let currentCredentials = credentials;
  let blockNextDiscovery = false;
  let enteredDiscovery!: () => void;
  let continueDiscovery!: () => void;
  const discoveryEntered = new Promise<void>((resolve) => {
    enteredDiscovery = resolve;
  });
  const discoveryContinues = new Promise<void>((resolve) => {
    continueDiscovery = resolve;
  });
  const discovery: PhotoAnalysisModelDiscovery = {
    discoverGemini: vi.fn(async () => {
      if (blockNextDiscovery) {
        blockNextDiscovery = false;
        enteredDiscovery();
        await discoveryContinues;
      }
      return [
        { id: "gemini-3.1-flash-lite", displayName: "Gemini", methods: ["generateContent"] },
      ];
    }),
    discoverJev: vi.fn(async () => [
      { id: "jev-1.13.0", effectiveId: "jev-1.13.0" },
    ]),
  };
  const service = new PhotoAnalysisConfigurationService(
    createDatabaseApplicationMetadata(database.getClient()),
    { read: async () => currentCredentials },
    discovery,
  );
  await service.save({
    geminiModel: "gemini-3.1-flash-lite",
    jevModel: "jev-1.13.0",
    categoryConfidenceThreshold: 0.25,
    productConfidenceThreshold: 0.6,
  });

  blockNextDiscovery = true;
  const captured = service.captureAttemptConfiguration();
  await discoveryEntered;
  currentCredentials = {
    geminiKey: "replacement-gemini-key",
    typeSafeKey: "replacement-typesafe-key",
  };
  await service.save({
    geminiModel: "gemini-3.1-flash-lite",
    jevModel: "jev-1.13.0",
    categoryConfidenceThreshold: 0.8,
    productConfidenceThreshold: 0.9,
  });
  continueDiscovery();

  await expect(captured).resolves.toMatchObject({
    geminiKey: "replacement-gemini-key",
    typeSafeKey: "replacement-typesafe-key",
    categoryConfidenceThreshold: 0.8,
    productConfidenceThreshold: 0.9,
  });
  expect(discovery.discoverGemini).toHaveBeenCalledWith(
    credentials.geminiKey,
    expect.any(AbortSignal),
  );
  expect(discovery.discoverGemini).toHaveBeenCalledWith(
    currentCredentials.geminiKey,
    expect.any(AbortSignal),
  );
  expect(discovery.discoverJev).toHaveBeenCalledWith(
    currentCredentials.typeSafeKey,
    expect.any(AbortSignal),
  );

  const unavailable = new PhotoAnalysisConfigurationService(
    createDatabaseApplicationMetadata(database.getClient()),
    { read: async () => currentCredentials },
    {
      discoverGemini: async () => [],
      discoverJev: async () => [],
    },
  );
  await expect(unavailable.captureAttemptConfiguration()).rejects.toBeInstanceOf(
    PhotoAnalysisAttemptConfigurationUnavailableError,
  );

  const unavailableJev = new PhotoAnalysisConfigurationService(
    createDatabaseApplicationMetadata(database.getClient()),
    { read: async () => currentCredentials },
    {
      discoverGemini: async () => [
        { id: "gemini-3.1-flash-lite", displayName: "Gemini", methods: ["generateContent"] },
      ],
      discoverJev: async () => [],
    },
  );
  await expect(unavailableJev.captureAttemptConfiguration()).rejects.toBeInstanceOf(
    PhotoAnalysisAttemptConfigurationUnavailableError,
  );
  await expect(unavailableJev.save({
    geminiModel: "gemini-3.1-flash-lite",
    jevModel: "jev-1.13.0",
    categoryConfidenceThreshold: 0.8,
    productConfidenceThreshold: 0.9,
  })).rejects.toMatchObject({
    fieldErrors: {
      jevModel: "Choose an available supported Jev model.",
    },
  });

  const rejectedJev = new PhotoAnalysisConfigurationService(
    createDatabaseApplicationMetadata(database.getClient()),
    { read: async () => currentCredentials },
    {
      discoverGemini: async () => [
        { id: "gemini-3.1-flash-lite", displayName: "Gemini", methods: ["generateContent"] },
      ],
      discoverJev: async () => { throw new Error("Jev discovery failed"); },
    },
  );
  await expect(rejectedJev.save({
    geminiModel: "gemini-3.1-flash-lite",
    jevModel: "jev-1.13.0",
    categoryConfidenceThreshold: 0.8,
    productConfidenceThreshold: 0.9,
  })).rejects.toThrow("Jev discovery failed");
});

test("cannot capture an attempt configuration without a usable credential pair", async () => {
  const service = new PhotoAnalysisConfigurationService(
    createDatabaseApplicationMetadata(database.getClient()),
    { read: async () => undefined },
    {
      discoverGemini: async () => [],
      discoverJev: async () => [],
    },
  );

  await expect(service.captureAttemptConfiguration()).rejects.toBeInstanceOf(
    PhotoAnalysisAttemptConfigurationUnavailableError,
  );

  const defaults = new PhotoAnalysisConfigurationService(
    createDatabaseApplicationMetadata(database.getClient()),
    { read: async () => credentials },
    {
      discoverGemini: async () => [
        { id: "gemini-3.1-flash-lite", displayName: "Gemini", methods: ["generateContent"] },
      ],
      discoverJev: async () => [
        { id: "jev-1.13.0", effectiveId: "jev-1.13.0" },
      ],
    },
  );
  await expect(defaults.captureAttemptConfiguration()).resolves.toMatchObject({
    categoryConfidenceThreshold: 0,
    productConfidenceThreshold: 0,
  });
});
