import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq, sql } from "drizzle-orm";
import { RouterContextProvider } from "react-router";
import { afterAll, beforeAll, expect, test } from "vitest";

import { serializeSessionCookie } from "../../app/auth/http.server";
import { getAuthenticationService } from "../../app/auth/runtime.server";
import {
  CatalogFoodNotFoundError,
  CatalogStaleReviewError,
  CatalogNutritionUnavailableError,
  FoodCatalog,
} from "../../app/catalog/food-catalog.server";
import {
  setFoodCatalogForTests,
  setFoodCatalogProviderForTests,
} from "../../app/catalog/runtime.server";
import {
  getApplicationDatabase,
  initializeApplicationDatabase,
  shutdownApplicationDatabase,
} from "../../app/database/runtime.server";
import { foodEntries, savedFoods } from "../../app/database/schema.server";
import {
  action as homeAction,
  headers,
  loader as homeLoader,
  meta,
} from "../../app/routes/home";
import { PhotoAnalysisService } from "../../app/photo-analysis/photo-analysis.server";
import { shutdownPhotoAnalysis } from "../../app/photo-analysis/runtime.server";
import { getFoodEntryService } from "../../app/food-entry/runtime.server";
import { getFoodLogService } from "../../app/food-log/runtime.server";
import { getGoalSetupService } from "../../app/setup/runtime.server";
import { validateSetupFields } from "../../app/setup/validation";
import { getWaterEventService } from "../../app/water-event/runtime.server";
import { seedAuthenticatedAccount } from "../support/authentication";

const origin = "http://localhost:3000";
const instant = "2026-08-31T16:00:00.000Z";
const today = "2026-08-31";
let temporaryDirectory: string;
let cookie: string;
let csrfToken: string;
let incompleteCookie: string;
let otherUserId: number;
let userId: number;

function routeArgs(request: Request) {
  return {
    context: new RouterContextProvider(),
    params: {},
    pattern: "/",
    request,
    url: new URL(request.url),
  };
}

function get(pathname = "/") {
  return new Request(`${origin}${pathname}`, {
    headers: {
      Cookie: cookie,
      "X-Test-Food-Log-Now": instant,
      "x-open-calory-request-id": "home-route-request",
    },
  });
}

function post(
  fields: Record<string, string>,
  options: { authenticated?: boolean; origin?: string; testInstant?: boolean } = {},
) {
  const provider: Record<string, string> =
    fields.intent === "log-food" && fields.provider === undefined
      ? { provider: "usda-fdc" }
      : {};
  const body = new URLSearchParams({
    csrfToken,
    date: today,
    ...provider,
    ...fields,
  });
  const requestHeaders = new Headers({
    Origin: options.origin ?? origin,
    "x-open-calory-request-id": "home-action-request",
  });
  if (options.testInstant !== false) {
    requestHeaders.set("X-Test-Food-Log-Now", instant);
  }
  if (options.authenticated !== false) requestHeaders.set("Cookie", cookie);
  return new Request(`${origin}/`, {
    body,
    headers: requestHeaders,
    method: "POST",
  });
}

async function load(pathname = "/") {
  const result = await homeLoader(routeArgs(get(pathname)));
  expect(result).not.toBeInstanceOf(Response);
  if (result instanceof Response) throw new Error(`home redirected from ${pathname}`);
  return result;
}

function expectRedirect(result: unknown, location: string) {
  expect(result).toBeInstanceOf(Response);
  expect((result as Response).status).toBe(302);
  expect((result as Response).headers.get("Location")).toBe(location);
}

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), "calory-home-routes-"));
  process.env.APPLICATION_URL = origin;
  process.env.DATABASE_PATH = path.join(temporaryDirectory, "application.sqlite");
  process.env.FOOD_CATALOG_TEST_FIXTURE = "1";
  process.env.PHOTO_ANALYSIS_TEST_FIXTURE = "1";
  process.env.FOOD_LOG_TEST_NOW = instant;
  process.env.SETUP_TEST_NOW = instant;
  initializeApplicationDatabase();

  const account = await getAuthenticationService().register(
    "home.route",
    "correct horse battery staple",
    "203.0.113.230",
  );
  if (!account.ok) throw new Error("home route account was not created");
  cookie = serializeSessionCookie(account.session).split(";", 1)[0];
  csrfToken = account.session.csrfToken;
  userId = account.session.user.id;
  const setup = validateSetupFields({
    calories: "2050",
    carbohydrate: "230",
    displayUnits: "us",
    fat: "70",
    fiber: "25",
    protein: "120",
    sodium: "2300",
    sugar: "50",
    timeZone: "America/New_York",
    water: "80",
  });
  if (!setup.success) throw new Error("home setup fixture was invalid");
  getGoalSetupService().completeInitial(account.session.user.id, setup.data);

  const incomplete = await seedAuthenticatedAccount(
    getAuthenticationService(),
    getApplicationDatabase().getClient(),
    "home.incomplete",
    "correct horse battery staple",
    "203.0.113.231",
  );
  incompleteCookie = serializeSessionCookie(incomplete).split(";", 1)[0];
  otherUserId = incomplete.user.id;
});

afterAll(async () => {
  shutdownPhotoAnalysis();
  shutdownApplicationDatabase();
  await rm(temporaryDirectory, { force: true, recursive: true });
  for (const name of [
    "APPLICATION_URL",
    "DATABASE_PATH",
    "FOOD_CATALOG_TEST_FIXTURE",
    "FOOD_LOG_TEST_NOW",
    "PHOTO_ANALYSIS_TEST_FIXTURE",
    "SETUP_TEST_NOW",
  ]) delete process.env[name];
});

test("home publishes metadata and enforces account/setup/date boundaries", async () => {
  expect(meta()).toEqual([
    { title: "Open Calorie Tracker · Private application" },
    {
      content: "Your private Open Calorie Tracker application space",
      name: "description",
    },
  ]);
  expect(headers()).toEqual({ "Cache-Control": "no-store" });

  const anonymous = await homeLoader(
    routeArgs(new Request(origin)),
  );
  expectRedirect(anonymous, "/login");

  const incomplete = await homeLoader(
    routeArgs(
      new Request(origin, { headers: { Cookie: incompleteCookie } }),
    ),
  );
  expectRedirect(incomplete, "/setup");

  const malformed = await homeLoader(
    routeArgs(get("/?date=not-a-date")) as never,
  ).catch((error: unknown) => error);
  expect(malformed).toBeInstanceOf(Response);
  expect((malformed as Response).status).toBe(400);
  await expect((malformed as Response).text()).resolves.toBe(
    "Food Log date is invalid",
  );

  const invalidInstant = await homeLoader(
    routeArgs(
      new Request(origin, {
        headers: { Cookie: cookie, "X-Test-Food-Log-Now": "not-an-instant" },
      }),
    ) as never,
  ).catch((error: unknown) => error);
  expect(invalidInstant).toBeInstanceOf(Response);
  expect((invalidInstant as Response).status).toBe(400);
  await expect((invalidInstant as Response).text()).resolves.toBe(
    "Test Food Log instant is invalid.",
  );

  const base = await load();
  expect(base.init?.status).toBe(200);
  expect(base.data).toMatchObject({
    calendar: undefined,
    catalog: undefined,
    csrfToken,
    foodEntryEditor: undefined,
    foodLog: {
      isFuture: false,
      selectedDate: today,
      today,
    },
    notice: undefined,
    username: "home.route",
    waterDialog: undefined,
  });
  expect(base.data.nearbyDates).toHaveLength(7);

  const withoutTestInstant = await homeLoader(
    routeArgs(new Request(origin, { headers: { Cookie: cookie } })),
  );
  expect(withoutTestInstant).not.toBeInstanceOf(Response);
  if (withoutTestInstant instanceof Response) throw new Error("Expected home data");
  expect(withoutTestInstant.data.foodLog.today).toBe(today);

  const calendar = await load("/?date=2026-08-30&calendar=2026-08");
  expect(calendar.data.calendar).toMatchObject({
    label: "August 2026",
    nextMonth: undefined,
    previousMonth: "2026-07",
  });

  for (const [notice, message] of [
    ["updated", "Food Entry updated. Daily totals refreshed."],
    ["deleted", "Food Entry deleted. Daily totals updated."],
    ["water-created", undefined],
    ["water-updated", "Water Event updated. Daily total refreshed."],
    ["water-deleted", "Water Event deleted. Daily total updated."],
    ["unknown", undefined],
  ] as const) {
    const result = await load(`/?notice=${notice}`);
    expect(result.data.notice).toBe(message);
  }
});

test("home loader maps every catalog search and detail state", async () => {
  const empty = await load("/?food=search");
  expect(empty.data.catalog).toEqual({ mode: "search", query: "", results: [], savedResults: [] });

  const invalid = await load("/?food=search&query=a");
  expect(invalid.init?.status).toBe(400);
  expect(invalid.data.catalog).toEqual({
    message: "Enter a food search from 2 to 100 characters.",
    mode: "search",
    query: "a",
    results: [],
    savedResults: [],
    title: "Search not sent",
  });

  const results = await load("/?food=search&query=yogurt");
  expect(results.init?.status).toBe(200);
  expect(results.data.catalog).toMatchObject({
    mode: "search",
    query: "yogurt",
    results: [{ name: "Plain nonfat Greek yogurt", providerFoodId: "1001" }],
  });

  for (const [query, expectedQuery, expectedStatus] of [
    ["ok", "ok", 200],
    [`${"a".repeat(100)}`, "a".repeat(100), 200],
    [`${"a".repeat(101)}`, "a".repeat(101), 400],
    ["%20%20yogurt%20%20", "yogurt", 200],
  ] as const) {
    const boundary = await load(`/?food=search&query=${query}`);
    expect(boundary.init?.status).toBe(expectedStatus);
    expect(boundary.data.catalog).toMatchObject({ query: expectedQuery });
  }

  for (const [query, status] of [
    ["not-installed", 503],
    ["malformed", 500],
    ["unavailable", 503],
  ] as const) {
    const result = await load(`/?food=search&query=${query}`);
    expect(result.init?.status).toBe(status);
    expect(result.data.catalog).toMatchObject({
      mode: "search",
      query,
      results: [],
    });
  }
  const packaged = await load("/?food=search&query=yogurt&filter=packaged");
  expect(packaged.data.catalog).toMatchObject({
    results: [{ provider: "usda-fdc", providerFoodId: "1001" }],
  });
  const packagedDetail = await load("/?food=0034000470693&provider=open-food-facts&query=example%20foods&filter=packaged");
  expect(packagedDetail.data.catalog).toMatchObject({
    food: { provider: "open-food-facts", providerFoodId: "0034000470693" },
    mode: "detail",
  });

  const detail = await load("/?food=1001&query=yogurt");
  expect(detail.data.catalog).toMatchObject({
    food: { name: "Plain nonfat Greek yogurt", providerFoodId: "1001" },
    mode: "detail",
    query: "yogurt",
  });
  if (detail.data.catalog?.mode !== "detail") throw new Error("Expected detail");
  expect(detail.data.catalog.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);

  const vanished = await load("/?food=4040&query=vanished");
  expect(vanished.init?.status).toBe(409);
  expect(vanished.data.catalog).toMatchObject({
    message:
      "USDA listed this food in search, but its details are no longer available. Choose another result.",
    mode: "search",
    query: "vanished",
    results: [{ providerFoodId: "1001" }],
    title: "Food no longer available",
  });

  const vanishedWithoutRefresh = await load("/?food=4040&query=unavailable");
  expect(vanishedWithoutRefresh.init?.status).toBe(409);
  if (vanishedWithoutRefresh.data.catalog?.mode !== "search") {
    throw new Error("Expected search fallback");
  }
  expect(vanishedWithoutRefresh.data.catalog.results).toEqual([]);
  const vanishedInvalidQuery = await load("/?food=4040&query=a");
  if (vanishedInvalidQuery.data.catalog?.mode !== "search") {
    throw new Error("Expected search fallback");
  }
  expect(vanishedInvalidQuery.data.catalog.results).toEqual([]);

  const unsafe = await load("/?food=9999&query=unsafe");
  expect(unsafe.init?.status).toBe(422);
  expect(unsafe.data.catalog).toMatchObject({
    message: "That food has no safe provider-backed measurement to log.",
    mode: "search",
    title: "Measurement unavailable",
  });

  const unavailable = await load("/?food=8888&query=yogurt");
  expect(unavailable.init?.status).toBe(503);
  expect(unavailable.data.catalog).toMatchObject({
    message: "USDA is unavailable right now. Your saved Food Entries are unaffected.",
    mode: "search",
    results: [],
    title: "USDA is unavailable",
  });

  const ignoredStage = await load("/?food=invalid&query=yogurt");
  expect(ignoredStage.data.catalog).toBeUndefined();
  for (const invalidFoodId of ["0", "01", "1x", "-1", "9007199254740992"]) {
    expect((await load(`/?food=${invalidFoodId}&query=yogurt`)).data.catalog)
      .toBeUndefined();
  }
  const futureStage = await load("/?date=2026-09-01&food=search&query=yogurt");
  expect(futureStage.data.catalog).toBeUndefined();
});

test("food search ignores unrelated and legacy URL parameters", async () => {
  const result = await load(
    `/?food=search&query=yogurt&provider=open-food-facts&filter=packaged&userId=${otherUserId}&barcode=0034000470693&unknown=ignored`,
  );

  expect(result.data.catalog).toMatchObject({
    mode: "search",
    query: "yogurt",
    results: [{
      name: "Plain nonfat Greek yogurt",
      provider: "usda-fdc",
      providerFoodId: "1001",
    }],
  });
  expect(result.data.catalog).not.toHaveProperty("filter");
  expect(result.data.catalog).not.toHaveProperty("provider");
});

test("missing USDA search returns a friendly user-safe response", async () => {
  const result = await load("/?food=search&query=not-installed");

  expect(result.init?.status).toBe(503);
  expect(result.data.catalog).toMatchObject({
    actionHref: "/settings/catalogs",
    actionLabel: "Open Food Catalogs",
    message:
      "USDA Foundation is not installed. Ask your administrator to install it in Food Catalogs Settings. Your saved Food Entries remain available.",
    mode: "search",
    query: "not-installed",
    results: [],
    title: "USDA Foundation is not installed",
  });
});

test("home loader exposes barcode lookup without creating a Food Entry", async () => {
  const chooser = await load("/?food=choose");
  expect(chooser.data.catalog).toEqual({ mode: "choose", query: "" });

  const empty = await load("/?food=barcode");
  expect(empty.data.catalog).toEqual({
    barcode: "",
    mode: "barcode",
    query: "",
  });

  const invalid = await load("/?food=barcode&barcode=123");
  expect(invalid.init?.status).toBe(400);
  expect(invalid.data.catalog).toEqual({
    barcode: "123",
    message: "Enter a supported 7, 8, 12, 13, or 14 digit barcode.",
    mode: "barcode",
    query: "",
    title: "Barcode not valid",
  });

  for (const barcode of ["a1234567", "1234567a"]) {
    const malformed = await load(`/?food=barcode&barcode=${barcode}`);
    expect(malformed.init?.status).toBe(400);
  }
  const trimmed = await load("/?food=barcode&barcode=%201234567%20");
  expect(trimmed.data.catalog).toMatchObject({
    barcode: "1234567",
    mode: "barcode",
  });

  const found = await load("/?food=barcode&barcode=034000470693");
  expect(found.data.catalog).toMatchObject({
    barcode: "034000470693",
    food: {
      authoritativeBaseUnit: "serving",
      barcode: "0034000470693",
      name: "Example cereal",
      provider: "open-food-facts",
      providerFoodId: "0034000470693",
      authoritativeBaseQuantityMicrounits: 1_000_000,
      brand: "Example Foods",
      dataType: "Open Food Facts",
      isSelectable: true,
      marketCountry: "United States",
      measurementSummary: "1 serving",
      measurements: [
        {
          baseQuantityMicrounits: 1_000_000,
          id: "serving",
          label: "1 serving",
          unit: "serving",
        },
      ],
      nutritionPerAuthoritativeBase: {
        carbohydrateMilligrams: { amount: 24, fixedPointMultiplier: 1_000 },
        energyMilliKcal: { amount: 180, fixedPointMultiplier: 1_000 },
        fatMilligrams: { amount: 0, fixedPointMultiplier: 1_000 },
        fiberMilligrams: null,
        proteinMilligrams: null,
        sodiumMilligrams: null,
        sugarMilligrams: null,
      },
      originalName: "Example cereal",
      providerModifiedDate: null,
      providerPublishedDate: null,
    },
    mode: "barcode",
    query: "",
  });
  if (found.data.catalog?.mode !== "barcode") {
    throw new Error("Expected barcode detail");
  }
  expect(found.data.catalog.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  expect(getFoodLogService().read(1, today)?.entries).toHaveLength(0);

  for (const [barcode, status, title, message] of [
    ["0000000000000", 503, "Open Food Facts is not installed", "Food Catalogs"],
    ["0000000000001", 404, "Product not found", "another code"],
    ["0000000000002", 422, "Nutrition unavailable", "calculation basis"],
    ["0000000000004", 503, "Open Food Facts is unavailable", "Retry"],
    ["0000000000005", 500, "Open Food Facts catalog data could not be used", "could not be used safely"],
    ["0000000000007", 422, "Measurement unavailable", "selected supported measurement"],
  ] as const) {
    const result = await load(`/?food=barcode&barcode=${barcode}`);
    expect(result.init?.status).toBe(status);
    if (result.data.catalog?.mode !== "barcode") {
      throw new Error("Expected barcode state");
    }
    expect(result.data.catalog.barcode).toBe(barcode);
    expect(result.data.catalog.query).toBe("");
    expect(result.data.catalog.title).toBe(title);
    expect(result.data.catalog.message).toContain(message);
    expect(result.data.catalog).toMatchObject(
      barcode === "0000000000000"
        ? {
            actionHref: "/settings/catalogs",
            actionLabel: "Open Food Catalogs",
          }
        : {},
    );
  }
});

test("home loader exposes a fresh manual Food Entry form without changing the log", async () => {
  const manual = await load("/?date=2026-08-30&food=manual");

  expect(manual.data.catalog).toMatchObject({
    mode: "manual",
    query: "",
  });
  if (manual.data.catalog?.mode !== "manual") {
    throw new Error("Expected manual Food Entry form");
  }
  expect(manual.data.catalog.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
  expect(getFoodLogService().read(1, "2026-08-30")?.entries).toHaveLength(0);
  expect((await load("/?date=2026-09-01&food=manual")).data.catalog)
    .toBeUndefined();
});

test("home passes request correlation to the catalog and propagates unknown failures", async () => {
  const contexts: string[] = [];
  const unexpected = new Error("unexpected catalog adapter failure");
  setFoodCatalogProviderForTests({
    async getFood(_providerFoodId, context) {
      contexts.push(context!.requestId);
      throw unexpected;
    },
    async search(query, context) {
      contexts.push(context!.requestId);
      if (query === "explode") throw unexpected;
      return [];
    },
  });
  try {
    const correlated = await load("/?food=search&query=none");
    if (correlated.data.catalog?.mode !== "search") throw new Error("Expected search");
    expect(correlated.data.catalog.results).toEqual([]);
    expect(contexts).toEqual(["home-route-request"]);

    const noRequestId = new Request(`${origin}/?food=search&query=none`, {
      headers: { Cookie: cookie, "X-Test-Food-Log-Now": instant },
    });
    const generated = await homeLoader(routeArgs(noRequestId));
    expect(generated).not.toBeInstanceOf(Response);
    expect(contexts[1]).toMatch(/^[0-9a-f-]{36}$/);

    const searchFailure = await homeLoader(
      routeArgs(get("/?food=search&query=explode")) as never,
    ).catch((error: unknown) => error);
    expect(searchFailure).toBe(unexpected);

    const detailFailure = await homeLoader(
      routeArgs(get("/?food=1001&query=none")) as never,
    ).catch((error: unknown) => error);
    expect(detailFailure).toBe(unexpected);

    const actionFailure = await homeAction(
      routeArgs(post({
        idempotencyKey: "unexpected-provider-failure",
        intent: "log-food",
        providerFoodId: "1001",
        quantity: "1",
        selectedMeasurementId: "base:g:100000000",
      })),
    ).catch((error: unknown) => error);
    expect(actionFailure).toBe(unexpected);
  } finally {
    setFoodCatalogProviderForTests(undefined);
  }

  let invalidQuerySearches = 0;
  setFoodCatalogProviderForTests({
    async getFood() {
      throw new CatalogFoodNotFoundError();
    },
    async search() {
      invalidQuerySearches += 1;
      return [];
    },
  });
  try {
    const notFound = await load("/?food=1001&query=a");
    expect(notFound.init?.status).toBe(409);
    expect(invalidQuerySearches).toBe(0);
  } finally {
    setFoodCatalogProviderForTests(undefined);
  }
});

test("home propagates an unexpected barcode provider failure", async () => {
  const unexpected = new Error("unexpected barcode adapter failure");
  setFoodCatalogForTests(
    new FoodCatalog([
      {
        capability: "barcode",
        provider: "open-food-facts",
        service: {
          async getFood() {
            throw unexpected;
          },
          async lookupBarcode() {
            throw unexpected;
          },
        },
      },
    ]),
  );
  const failure = await homeLoader(
    routeArgs(get("/?food=barcode&barcode=034000470693")) as never,
  ).catch((error: unknown) => error);
  expect(failure).toBe(unexpected);
  setFoodCatalogProviderForTests(undefined);
});

test("home actions enforce security, request shape, and writable dates", async () => {
  const wrongOrigin = await homeAction(
    routeArgs(post({ intent: "add-food" }, { origin: "https://attacker.example" })) as never,
  ).catch((error: unknown) => error);
  expect(wrongOrigin).toBeInstanceOf(Response);
  expect((wrongOrigin as Response).status).toBe(403);

  const anonymous = await homeAction(
    routeArgs(post({ intent: "add-food" }, { authenticated: false })),
  );
  expectRedirect(anonymous, "/login");
  expect((anonymous as Response).headers.get("Set-Cookie")).toContain("Max-Age=0");

  const rejectedCsrf = await homeAction(
    routeArgs(post({ csrfToken: "wrong", intent: "add-food" })) as never,
  ).catch((error: unknown) => error);
  expect(rejectedCsrf).toBeInstanceOf(Response);
  expect((rejectedCsrf as Response).status).toBe(403);
  await expect((rejectedCsrf as Response).text()).resolves.toBe(
    "CSRF token rejected.",
  );

  const invalid = await homeAction(
    routeArgs(post({ intent: "unknown" })),
  );
  expect(invalid).toMatchObject({
    data: { message: "The Food Log request was invalid." },
    init: { status: 400 },
  });

  const future = await homeAction(
    routeArgs(post({ date: "2026-09-01", intent: "add-food" })),
  );
  expect(future).toMatchObject({
    data: { message: "Future Food Logs cannot be changed" },
    init: { status: 422 },
  });

  const malformed = await homeAction(
    routeArgs(post({ date: "not-a-date", intent: "add-food" })),
  );
  expect(malformed).toMatchObject({
    data: { message: "Food Log date is invalid" },
    init: { status: 400 },
  });

  const writableDateService = getFoodLogService();
  const originalRequireWritableDate =
    writableDateService.requireWritableDate.bind(writableDateService);
  const unexpectedWritableDate = new Error("unexpected writable-date failure");
  writableDateService.requireWritableDate = () => {
    throw unexpectedWritableDate;
  };
  try {
    const unexpected = await homeAction(
      routeArgs(post({ intent: "add-food" }, { testInstant: false })),
    ).catch((error: unknown) => error);
    expect(unexpected).toBe(unexpectedWritableDate);
  } finally {
    writableDateService.requireWritableDate = originalRequireWritableDate;
  }

  expectRedirect(
    await homeAction(routeArgs(post({ intent: "add-food" }))),
    "/?date=2026-08-31&food=choose",
  );
  expectRedirect(
    await homeAction(routeArgs(post({ intent: "add-water" }))),
    "/?date=2026-08-31&water=new",
  );
});

test("home water actions create, edit, detect conflicts, and delete", async () => {
  const invalid = await homeAction(
    routeArgs(
      post({ intent: "create-water", waterAmount: "0", waterSelection: "exact" }),
    ),
  );
  expect(invalid).toMatchObject({
    data: { tone: "error" },
    init: { status: 400 },
  });

  const created = await homeAction(
    routeArgs(
      post({ intent: "create-water", waterAmount: "12.5", waterSelection: "exact" }),
    ),
  );
  expectRedirect(created, "/?date=2026-08-31");
  const preset = await homeAction(
    routeArgs(post({ intent: "create-water", waterSelection: "16" })),
  );
  expectRedirect(preset, "/?date=2026-08-31");
  for (const waterSelection of ["8", "24"]) {
    expectRedirect(
      await homeAction(routeArgs(post({ intent: "create-water", waterSelection }))),
      "/?date=2026-08-31",
    );
  }
  const previous = await homeAction(
    routeArgs(
      post({
        date: "2026-08-30",
        intent: "create-water",
        waterAmount: "9",
        waterSelection: "exact",
      }),
    ),
  );
  expectRedirect(previous, "/?date=2026-08-30");
  const previousEvent = (await load("/?date=2026-08-30")).data.foodLog.events
    .find((candidate) => candidate.kind === "water")!;
  const wrongDateDialog = await homeLoader(
    routeArgs(get(`/?water=${previousEvent.id}`)) as never,
  ).catch((error: unknown) => error);
  expect(wrongDateDialog).toBeInstanceOf(Response);
  expect((wrongDateDialog as Response).status).toBe(404);

  const loaded = await load();
  const waterEvents = loaded.data.foodLog.events.filter(
    (event) => event.kind === "water",
  );
  expect(waterEvents).toHaveLength(4);
  const event = waterEvents[0];

  const newDialog = await load("/?water=new");
  expect(newDialog.data.waterDialog).toEqual({ mode: "create" });
  const editDialog = await load(`/?water=${event.id}`);
  expect(editDialog.data.waterDialog).toMatchObject({
    event: { id: event.id },
    mode: "edit",
  });
  const leadingZeroWater = await homeLoader(
    routeArgs(get(`/?water=0${event.id}`)),
  ).catch((error: unknown) => error);
  expect(leadingZeroWater).toBeInstanceOf(Response);
  expect((leadingZeroWater as Response).status).toBe(404);
  await expect((leadingZeroWater as Response).text()).resolves.toBe(
    "Water Event is unavailable.",
  );
  const invalidDialog = await homeLoader(
    routeArgs(get("/?water=invalid")) as never,
  ).catch((error: unknown) => error);
  expect(invalidDialog).toBeInstanceOf(Response);
  expect((invalidDialog as Response).status).toBe(404);
  for (const invalidId of ["0", "01", "1x", "-1", "9007199254740992"]) {
    const result = await homeLoader(routeArgs(get(`/?water=${invalidId}`)))
      .catch((error: unknown) => error);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(404);
  }

  const loaderWaterService = getWaterEventService();
  const originalWaterRead = loaderWaterService.read.bind(loaderWaterService);
  const unexpectedWaterRead = new Error("unexpected water read failure");
  loaderWaterService.read = () => {
    throw unexpectedWaterRead;
  };
  try {
    const request = new Request(`${origin}/?water=${event.id}`, {
      headers: { Cookie: cookie },
    });
    const unexpected = await homeLoader(routeArgs(request))
      .catch((error: unknown) => error);
    expect(unexpected).toBe(unexpectedWaterRead);
  } finally {
    loaderWaterService.read = originalWaterRead;
  }

  const unavailable = await homeAction(
    routeArgs(
      post({
        eventId: "999999",
        expectedUpdatedAt: event.updatedAt,
        intent: "delete-water",
      }),
    ),
  );
  expect(unavailable).toMatchObject({
    data: { tone: "error" },
    init: { status: 404 },
  });
  for (const waterSelection of ["8", "16", "24"]) {
    const acceptedPreset = await homeAction(
      routeArgs(post({
        eventId: "999999",
        expectedUpdatedAt: event.updatedAt,
        intent: "update-water",
        waterEventTime: "13:15",
        waterSelection,
      })),
    );
    expect(acceptedPreset).toMatchObject({ init: { status: 404 } });
  }

  const waterService = getWaterEventService();
  const originalWaterUpdate = waterService.update.bind(waterService);
  const unexpectedWater = new Error("unexpected water failure");
  waterService.update = () => {
    throw unexpectedWater;
  };
  try {
    const unexpected = await homeAction(
      routeArgs(post({
        eventId: String(event.id),
        expectedUpdatedAt: event.updatedAt,
        intent: "update-water",
        waterAmount: "10",
        waterEventTime: "13:15",
        waterSelection: "exact",
      }, { testInstant: false })),
    ).catch((error: unknown) => error);
    expect(unexpected).toBe(unexpectedWater);
  } finally {
    waterService.update = originalWaterUpdate;
  }

  const stale = await homeAction(
    routeArgs(
      post({
        eventId: String(event.id),
        expectedUpdatedAt: "2000-01-01T00:00:00.000Z",
        intent: "update-water",
        waterAmount: "10",
        waterEventTime: "13:15",
        waterSelection: "exact",
      }),
    ),
  );
  expect(stale).toMatchObject({
    data: { tone: "error", waterEventEditor: { id: event.id } },
    init: { status: 409 },
  });

  const updated = await homeAction(
    routeArgs(
      post({
        eventId: String(event.id),
        expectedUpdatedAt: event.updatedAt,
        intent: "update-water",
        waterAmount: "10",
        waterEventTime: "13:15",
        waterSelection: "exact",
      }),
    ),
  );
  expectRedirect(updated, "/?date=2026-08-31&notice=water-updated");
  const updatedDialog = (await load(`/?water=${event.id}`)).data.waterDialog;
  if (updatedDialog?.mode !== "edit") throw new Error("Expected water editor");
  const updatedEvent = updatedDialog.event;
  expect(updatedEvent).toMatchObject({ amountMicroliters: 295_735, localEventTime: "13:15:00" });

  const deleted = await homeAction(
    routeArgs(
      post({
        eventId: String(event.id),
        expectedUpdatedAt: updatedEvent.updatedAt,
        intent: "delete-water",
      }),
    ),
  );
  expectRedirect(deleted, "/?date=2026-08-31&notice=water-deleted");
});

test("home food actions log, edit, detect conflicts, delete, and map catalog failures", async () => {
  const missingProvider = await homeAction(
    routeArgs(
      post({
        idempotencyKey: "food-missing-provider",
        intent: "log-food",
        provider: "",
        providerFoodId: "1001",
        quantity: "1",
        selectedMeasurementId: "base:g:100000000",
      }),
    ),
  );
  expect(missingProvider).toMatchObject({
    data: { message: "The Food Log request was invalid." },
    init: { status: 400 },
  });

  const unknownProvider = await homeAction(
    routeArgs(
      post({
        idempotencyKey: "food-unknown-provider",
        intent: "log-food",
        provider: "not-registered",
        providerFoodId: "1001",
        quantity: "1",
        selectedMeasurementId: "base:g:100000000",
      }),
    ),
  );
  expect(unknownProvider).toMatchObject({
    data: {
      message: "The selected Food Catalog provider is unavailable.",
      tone: "error",
    },
    init: { status: 400 },
  });

  const openFoodFacts = await homeAction(
    routeArgs(
      post({
        carbohydrateGrams: "999999",
        energyKcal: "999999",
        idempotencyKey: "off-route-success",
        intent: "log-food",
        name: "Browser-controlled name",
        provider: "open-food-facts",
        providerFoodId: "0034000470693",
        quantity: "0.5",
        selectedMeasurementId: "serving",
      }),
    ),
  );
  expectRedirect(openFoodFacts, "/?date=2026-08-31");
  const repeatedOpenFoodFacts = await homeAction(
    routeArgs(
      post({
        idempotencyKey: "off-route-success",
        intent: "log-food",
        provider: "open-food-facts",
        providerFoodId: "0034000470693",
        quantity: "0.5",
        selectedMeasurementId: "serving",
      }),
    ),
  );
  expectRedirect(repeatedOpenFoodFacts, "/?date=2026-08-31");
  const savedOpenFoodFacts = (await load()).data.foodLog.entries.filter(
    (entry) => entry.provider === "open-food-facts",
  );
  expect(savedOpenFoodFacts).toHaveLength(1);
  expect(savedOpenFoodFacts[0]).toMatchObject({
    carbohydrateMilligrams: 12_000,
    energyMilliKcal: 90_000,
    fatMilligrams: 0,
    name: "Example cereal",
    proteinMilligrams: null,
    quantityMicrounits: 500_000,
    selectedMeasurementLabel: "1 serving",
  });

  for (const [providerFoodId, status] of [
    ["0000000000000", 503],
    ["0000000000001", 404],
    ["0000000000002", 422],
    ["0000000000004", 503],
    ["0000000000005", 500],
    ["0000000000007", 422],
  ] as const) {
    const failedConfirmation = await homeAction(
      routeArgs(
        post({
          idempotencyKey: `off-confirmation-${providerFoodId}`,
          intent: "log-food",
          provider: "open-food-facts",
          providerFoodId,
          quantity: "1",
          selectedMeasurementId: "serving",
        }),
      ),
    );
    expect(failedConfirmation).toMatchObject({
      data: { tone: "error" },
      init: { status },
    });
  }

  const invalid = await homeAction(
    routeArgs(
      post({
        idempotencyKey: "food-invalid",
        intent: "log-food",
        providerFoodId: "1001",
        quantity: "0",
        selectedMeasurementId: "base:g:100000000",
      }),
    ),
  );
  expect(invalid).toMatchObject({ data: { tone: "error" }, init: { status: 400 } });

  for (const [providerFoodId, status] of [
    ["4040", 409],
    ["9999", 422],
    ["8888", 503],
  ] as const) {
    const failure = await homeAction(
      routeArgs(
        post({
          idempotencyKey: `food-failure-${providerFoodId}`,
          intent: "log-food",
          providerFoodId,
          quantity: "1",
          selectedMeasurementId: "base:g:100000000",
        }),
      ),
    );
    expect(failure).toMatchObject({
      data: { tone: "error" },
      init: { status },
    });
  }

  const logged = await homeAction(
    routeArgs(
      post({
        idempotencyKey: "food-route-success",
        intent: "log-food",
        providerFoodId: "1001",
        quantity: "1",
        selectedMeasurementId: "base:g:100000000",
      }),
    ),
  );
  expectRedirect(logged, "/?date=2026-08-31");
  const previousLogged = await homeAction(
    routeArgs(
      post({
        date: "2026-08-30",
        idempotencyKey: "food-route-previous",
        intent: "log-food",
        providerFoodId: "1001",
        quantity: "1",
        selectedMeasurementId: "base:g:100000000",
      }),
    ),
  );
  expectRedirect(previousLogged, "/?date=2026-08-30");
  const previousFood = (await load("/?date=2026-08-30")).data.foodLog.entries[0];
  const wrongDateEditor = await homeLoader(
    routeArgs(get(`/?entry=${previousFood.id}`)) as never,
  ).catch((error: unknown) => error);
  expect(wrongDateEditor).toBeInstanceOf(Response);
  expect((wrongDateEditor as Response).status).toBe(404);
  const base = await load();
  const food = base.data.foodLog.entries.find(
    (entry) => entry.providerFoodId === "1001",
  )!;
  expect(food).toBeDefined();

  const editor = await load(`/?entry=${food.id}`);
  expect(editor.data.foodEntryEditor).toMatchObject({ id: food.id });
  const leadingZeroEntry = await homeLoader(
    routeArgs(get(`/?entry=0${food.id}`)),
  ).catch((error: unknown) => error);
  expect(leadingZeroEntry).toBeInstanceOf(Response);
  expect((leadingZeroEntry as Response).status).toBe(404);
  await expect((leadingZeroEntry as Response).text()).resolves.toBe(
    "Food Entry is unavailable.",
  );
  const invalidEditor = await homeLoader(
    routeArgs(get("/?entry=invalid")) as never,
  ).catch((error: unknown) => error);
  expect(invalidEditor).toBeInstanceOf(Response);
  expect((invalidEditor as Response).status).toBe(404);
  for (const invalidId of ["0", "01", "1x", "-1", "9007199254740992"]) {
    const result = await homeLoader(routeArgs(get(`/?entry=${invalidId}`)))
      .catch((error: unknown) => error);
    expect(result).toBeInstanceOf(Response);
    expect((result as Response).status).toBe(404);
  }


  const loaderFoodService = getFoodEntryService();
  const originalFoodRead = loaderFoodService.read.bind(loaderFoodService);
  const unexpectedFoodRead = new Error("unexpected food read failure");
  loaderFoodService.read = () => {
    throw unexpectedFoodRead;
  };
  try {
    const request = new Request(`${origin}/?entry=${food.id}`, {
      headers: { Cookie: cookie },
    });
    const unexpected = await homeLoader(routeArgs(request))
      .catch((error: unknown) => error);
    expect(unexpected).toBe(unexpectedFoodRead);
  } finally {
    loaderFoodService.read = originalFoodRead;
  }

  const common = {
    carbohydrateGrams: "3.5",
    energyKcal: "60",
    entryId: String(food.id),
    expectedUpdatedAt: food.updatedAt,
    fatGrams: "0",
    fiberGrams: "1.25",
    name: "Edited yogurt",
    proteinGrams: "10.5",
    quantity: "1",
    selectedMeasurementId: "base:g:100000000",
    sodiumMilligrams: "36",
    sugarGrams: "3.5",
  };
  const invalidUpdate = await homeAction(
    routeArgs(post({ ...common, intent: "update-food", name: "" })),
  );
  expect(invalidUpdate).toMatchObject({ data: { tone: "error" }, init: { status: 400 } });

  const stale = await homeAction(
    routeArgs(
      post({ ...common, expectedUpdatedAt: "2000-01-01T00:00:00.000Z", intent: "update-food" }),
    ),
  );
  expect(stale).toMatchObject({
    data: { foodEntryEditor: { id: food.id }, tone: "error" },
    init: { status: 409 },
  });

  const updated = await homeAction(
    routeArgs(post({ ...common, intent: "update-food" })),
  );
  expectRedirect(updated, "/?date=2026-08-31&notice=updated");
  const updatedFood = (await load(`/?entry=${food.id}`)).data.foodEntryEditor!;
  expect(updatedFood).toMatchObject({
    carbohydrateMilligrams: 3_500,
    energyMilliKcal: 60_000,
    fatMilligrams: 0,
    fiberMilligrams: 1_250,
    name: "Edited yogurt",
    proteinMilligrams: 10_500,
    sodiumMilligrams: 36,
    sugarMilligrams: 3_500,
  });

  const unavailable = await homeAction(
    routeArgs(
      post({
        entryId: "999999",
        expectedUpdatedAt: updatedFood.updatedAt,
        intent: "delete-food",
      }),
    ),
  );
  expect(unavailable).toMatchObject({ data: { tone: "error" }, init: { status: 404 } });

  const foodService = getFoodEntryService();
  const originalFoodUpdate = foodService.update.bind(foodService);
  const unexpectedFood = new Error("unexpected food failure");
  foodService.update = () => {
    throw unexpectedFood;
  };
  try {
    const unexpected = await homeAction(
      routeArgs(post({ ...common, intent: "update-food" }, { testInstant: false })),
    ).catch((error: unknown) => error);
    expect(unexpected).toBe(unexpectedFood);
  } finally {
    foodService.update = originalFoodUpdate;
  }

  const deleted = await homeAction(
    routeArgs(
      post({
        entryId: String(food.id),
        expectedUpdatedAt: updatedFood.updatedAt,
        intent: "delete-food",
      }),
    ),
  );
  expectRedirect(deleted, "/?date=2026-08-31&notice=deleted");
});

test("log-food ignores a submitted userId and writes only to the authenticated user", async () => {
  const idempotencyKey = "authenticated-owner-only";
  const result = await homeAction(
    routeArgs(
      post({
        date: "2026-08-27",
        idempotencyKey,
        intent: "log-food",
        providerFoodId: "1001",
        quantity: "1",
        selectedMeasurementId: "base:g:100000000",
        userId: String(otherUserId),
      }),
    ),
  );
  expectRedirect(result, "/?date=2026-08-27");

  const saved = getApplicationDatabase()
    .getClient()
    .select({ userId: foodEntries.userId })
    .from(foodEntries)
    .where(eq(foodEntries.idempotencyKey, idempotencyKey))
    .get();
  expect(saved).toEqual({ userId });
  expect(saved?.userId).not.toBe(otherUserId);
});

test("home copies a historical Food Entry to today and returns to the source log with a notice", async () => {
  const source = await getFoodEntryService(new Date(instant)).log(
    userId,
    {
      foodLogDate: "2026-08-29",
      idempotencyKey: "route-copy-source",
      provider: "usda-fdc",
      providerFoodId: "1001",
      quantity: "1",
      selectedMeasurementId: "base:g:100000000",
    },
  );
  const copyFields = {
    date: source.foodLogDate,
    entryId: String(source.id),
    idempotencyKey: `copy:${source.id}:route-action`,
    intent: "copy-food-to-today",
  };

  const copied = await homeAction(routeArgs(post(copyFields)));
  expect(copied).toBeInstanceOf(Response);
  const destination = (copied as Response).headers.get("Location")!;
  const destinationUrl = new URL(destination, origin);
  expect(destinationUrl.searchParams.get("date")).toBe(source.foodLogDate);
  expect(destinationUrl.searchParams.get("notice")).toBe("copied");
  expect(destinationUrl.searchParams.get("copied")).toMatch(/^[1-9]\d*$/);
  expectRedirect(copied, destination);
  const repeated = await homeAction(routeArgs(post(copyFields)));
  expectRedirect(repeated, destination);

  const sourcePage = await load(destination);
  expect(sourcePage.data.notice).toBe(
    `Copied ${source.name} to today's Food Log.`,
  );
  expect(sourcePage.data.foodLog.entries).toHaveLength(1);
  const todayPage = await load();
  expect(
    todayPage.data.foodLog.entries.filter(
      (entry) => entry.name === source.name && entry.foodLogDate === today,
    ),
  ).toHaveLength(1);

  for (const [entryId, status] of [
    ["invalid", 400],
    ["999999", 404],
  ] as const) {
    const failure = await homeAction(
      routeArgs(
        post({
          ...copyFields,
          entryId,
          idempotencyKey: `copy:${entryId}:failure`,
        }),
      ),
    );
    expect(failure).toMatchObject({
      data: { tone: "error" },
      init: { status },
    });
    expect((failure as { data: { message: string } }).data.message).not.toContain(
      "Copied",
    );
  }

  const fabricatedNotice = await load(
    "/?date=2026-08-29&notice=copied&copied=999999",
  );
  expect(fabricatedNotice.data.notice).toBeUndefined();
  const fabricatedOwnedNotice = await load(
    `/?date=2026-08-29&notice=copied&copied=${source.id}`,
  );
  expect(fabricatedOwnedNotice.data.notice).toBeUndefined();

  const client = getApplicationDatabase().getClient();
  const failureKey = `copy:${source.id}:route-transaction-failure`;
  client.run(sql.raw(`CREATE TRIGGER fail_route_food_entry_copy
    BEFORE INSERT ON food_entries
    WHEN NEW.idempotency_key = '${failureKey}'
    BEGIN
      SELECT RAISE(ABORT, 'simulated route copy failure');
    END`));
  try {
    const transactionFailure = await homeAction(
      routeArgs(
        post({
          ...copyFields,
          idempotencyKey: failureKey,
        }),
      ),
    );
    expect(transactionFailure).toMatchObject({
      data: {
        message: "The Food Entry could not be copied. Try again.",
        tone: "error",
      },
      init: { status: 500 },
    });
  } finally {
    client.run(sql.raw("DROP TRIGGER fail_route_food_entry_copy"));
  }
  expect((await load("/?date=2026-08-29")).data.foodLog.entries).toHaveLength(1);
});

test("home opens a copy-date calendar and confirms one copy while staying on the source log", async () => {
  const source = await getFoodEntryService(new Date(instant)).log(userId, {
    foodLogDate: "2026-08-26",
    idempotencyKey: "route-copy-date-source",
    provider: "usda-fdc",
    providerFoodId: "1001",
    quantity: "1",
    selectedMeasurementId: "base:g:100000000",
  });

  const opened = await load(`/?date=${source.foodLogDate}&copy=${source.id}`);
  expect(opened.data.copyDialog).toMatchObject({
    destinationDate: undefined,
    entry: { id: source.id, name: source.name },
  });
  const unavailableDialog = await load(
    `/?date=${source.foodLogDate}&copy=999999`,
  );
  expect(unavailableDialog.data).toMatchObject({
    copyDialog: undefined,
    copyError: "That Food Entry is unavailable. Choose another entry.",
  });

  const selected = await load(
    `/?date=${source.foodLogDate}&copy=${source.id}&copyDate=2026-08-27`,
  );
  expect(selected.data.copyDialog?.destinationDate).toBe("2026-08-27");
  const copyFields = {
    date: source.foodLogDate,
    destinationDate: "2026-08-27",
    entryId: String(source.id),
    idempotencyKey: selected.data.copyDialog!.idempotencyKey,
    intent: "copy-food-to-date",
  };

  const copied = await homeAction(routeArgs(post(copyFields)));
  const destination = (copied as Response).headers.get("Location")!;
  expectRedirect(copied, destination);
  expect(new URL(destination, origin).searchParams.get("date")).toBe(
    source.foodLogDate,
  );
  const sourcePage = await load(destination);
  expect(sourcePage.data.notice).toBe(
    `Copied ${source.name} to Thursday, August 27, 2026.`,
  );
  expect(sourcePage.data.foodLog.entries).toContainEqual(source);
  const destinationPage = await load("/?date=2026-08-27");
  expect(destinationPage.data.foodLog.entries).toContainEqual(
    expect.objectContaining({
      foodLogDate: "2026-08-27",
      localEventTime: "12:00:00",
      name: source.name,
    }),
  );

  for (const destinationDate of [source.foodLogDate, "2026-09-01", "invalid"]) {
    const failure = await homeAction(
      routeArgs(post({
        ...copyFields,
        destinationDate,
        idempotencyKey: `copy:${source.id}:route-date-failure-${destinationDate}`,
      })),
    );
    expect(failure).toMatchObject({ data: { tone: "error" } });
    expect((failure as { data: { message: string } }).data.message).not.toContain(
      "Copied",
    );
  }
});

test("home creates manual Food Entries on the selected date and preserves invalid drafts", async () => {
  const fields = {
    carbohydrateGrams: "36",
    energyKcal: "180",
    fatGrams: "3",
    fiberGrams: "4",
    idempotencyKey: "manual-route-success",
    intent: "log-manual-food",
    name: "Tortillas",
    proteinGrams: "6",
    quantity: "3",
    sodiumMilligrams: "30",
    sugarGrams: "1",
  };
  const created = await homeAction(
    routeArgs(post({ ...fields, date: "2026-08-30" })),
  );

  expectRedirect(created, "/?date=2026-08-30");
  expect((await load("/?date=2026-08-30")).data.foodLog.entries[0])
    .toMatchObject({
      energyMilliKcal: 180_000,
      name: "Tortillas",
      provider: "manual",
      quantityMicrounits: 3_000_000,
    });

  const invalidFields = {
    ...fields,
    energyKcal: "",
    idempotencyKey: "manual-route-invalid",
    name: "Incomplete tortilla",
  };
  const invalid = await homeAction(routeArgs(post(invalidFields)));
  expect(invalid).toMatchObject({
    data: {
      manualFoodDraft: invalidFields,
      tone: "error",
    },
    init: { status: 400 },
  });
  if (invalid instanceof Response) throw new Error("Expected action data");
  expect(invalid.data.message).toContain("calories");
  expect((await load()).data.foodLog.entries.some(
    (entry) => entry.providerFoodId === "manual-route-invalid",
  )).toBe(false);

  const future = await homeAction(
    routeArgs(post({
      ...fields,
      date: "2026-09-01",
      idempotencyKey: "manual-route-future",
    })),
  );
  expect(future).toMatchObject({
    data: {
      manualFoodDraft: {
        ...fields,
        date: "2026-09-01",
        idempotencyKey: "manual-route-future",
      },
      tone: "error",
    },
    init: { status: 422 },
  });
});

test("Add Food searches My foods and reuses a manual snapshot on the viewed day", async () => {
  const created = await homeAction(routeArgs(post({
    date: "2026-08-27",
    energyKcal: "100",
    idempotencyKey: "route-my-food-tortilla",
    intent: "log-manual-food",
    name: "Mexican tortilla",
    quantity: "2",
  })));
  expectRedirect(created, "/?date=2026-08-27");

  const myFoods = await load("/?date=2026-08-29&food=my");
  expect(myFoods.data.catalog?.mode).toBe("my");
  if (!myFoods.data.catalog || myFoods.data.catalog.mode !== "my") {
    throw new Error("My foods did not open");
  }
  expect(myFoods.data.catalog.results).toEqual(expect.arrayContaining([
    expect.objectContaining({
      name: "Mexican tortilla",
      energyMilliKcal: 100_000,
      quantityMicrounits: 2_000_000,
    }),
  ]));
  const searched = await load("/?date=2026-08-29&food=search&query=tortilla");
  expect(searched.data.catalog?.mode).toBe("search");
  if (!searched.data.catalog || searched.data.catalog.mode !== "search") {
    throw new Error("Search did not open");
  }
  expect(searched.data.catalog.savedResults.some((food) => food.name === "Mexican tortilla"))
    .toBe(true);
  const saved = myFoods.data.catalog;
  const savedFoodId = saved.results.find((food) => food.name === "Mexican tortilla")?.id;
  if (savedFoodId === undefined) throw new Error("Saved food is missing");
  const detail = await load(`/?date=2026-08-29&food=saved:${savedFoodId}`);
  expect(detail.data.catalog?.mode).toBe("saved");
  if (!detail.data.catalog || detail.data.catalog.mode !== "saved") {
    throw new Error("Saved food did not open");
  }
  expect(detail.data.catalog.food).toMatchObject({
    name: "Mexican tortilla",
    energyMilliKcal: 100_000,
  });

  const reused = await homeAction(routeArgs(post({
    date: "2026-08-29",
    idempotencyKey: "route-my-food-reuse",
    intent: "log-saved-food",
    savedFoodId: String(savedFoodId),
  })));
  expectRedirect(reused, "/?date=2026-08-29");
  expect((await load("/?date=2026-08-29")).data.foodLog.entries)
    .toContainEqual(expect.objectContaining({
      name: "Mexican tortilla",
      energyMilliKcal: 100_000,
      quantityMicrounits: 2_000_000,
    }));
});

test("reusing My foods does not offer to save the same food again", async () => {
  const service = getFoodEntryService(new Date(instant));
  const original = service.logManual(userId, {
    energyKcal: "115",
    foodLogDate: "2026-08-26",
    idempotencyKey: "route-linked-food-original",
    name: "Linked tortilla QA",
    quantity: "2",
  });
  const saved = service.listSavedFoods(userId, "Linked tortilla QA");
  expect(saved).toHaveLength(1);

  const reused = service.logSavedFood(
    userId,
    saved[0].id,
    "2026-08-28",
    "route-linked-food-reuse",
  );
  expect((await load(`/?date=2026-08-28&entry=${reused.id}`)).data.manualEntrySaved)
    .toBe(true);
  const copied = service.copyToDate(userId, reused.id, {
    destinationFoodLogDate: "2026-08-29",
    foodLogDate: reused.foodLogDate,
    idempotencyKey: `copy:${reused.id}:linked-food`,
  });
  expect((await load(`/?date=2026-08-29&entry=${copied.id}`)).data.manualEntrySaved)
    .toBe(true);

  const repeatedSave = await homeAction(routeArgs(post({
    date: "2026-08-28",
    entryId: String(reused.id),
    intent: "save-manual-food",
  })));
  expectRedirect(repeatedSave, `/?date=2026-08-28&entry=${reused.id}&notice=food-saved`);
  expect(service.listSavedFoods(userId, "Linked tortilla QA")).toHaveLength(1);

  const distinct = service.logManual(userId, {
    energyKcal: "115",
    foodLogDate: "2026-08-25",
    idempotencyKey: "route-linked-food-distinct",
    name: "Linked tortilla QA",
    quantity: "2",
  });
  getApplicationDatabase().getClient()
    .delete(savedFoods)
    .where(eq(savedFoods.sourceEntryId, distinct.id))
    .run();
  expect((await load(`/?date=2026-08-25&entry=${distinct.id}`)).data.manualEntrySaved)
    .toBe(false);
  await homeAction(routeArgs(post({
    date: "2026-08-25",
    entryId: String(distinct.id),
    intent: "save-manual-food",
  })));
  expect(service.listSavedFoods(userId, "Linked tortilla QA")).toHaveLength(2);
  expect(original.id).not.toBe(distinct.id);
});

test("an older manual entry joins My foods only after the entry action", async () => {
  const source = getFoodEntryService(new Date(instant)).logManual(userId, {
    energyKcal: "90",
    foodLogDate: "2026-08-24",
    idempotencyKey: "route-historical-food",
    name: "Old manual flatbread",
    quantity: "1",
  });
  getApplicationDatabase().getClient()
    .delete(savedFoods)
    .where(eq(savedFoods.sourceEntryId, source.id))
    .run();
  const before = await load(`/?date=2026-08-24&entry=${source.id}`);
  expect(before.data.manualEntrySaved).toBe(false);
  const saved = await homeAction(routeArgs(post({
    date: "2026-08-24",
    entryId: String(source.id),
    intent: "save-manual-food",
  })));
  expectRedirect(saved, `/?date=2026-08-24&entry=${source.id}&notice=food-saved`);
  expect((await load(`/?date=2026-08-24&entry=${source.id}`)).data.manualEntrySaved)
    .toBe(true);
  expect((await load("/?date=2026-08-31&food=my&query=flatbread")).data.catalog)
    .toMatchObject({
      mode: "my",
      results: [expect.objectContaining({ name: "Old manual flatbread" })],
    });
});

test("My foods rejects missing products and cannot save an entry from another day", async () => {
  const source = getFoodEntryService(new Date(instant)).logManual(userId, {
    energyKcal: "80",
    foodLogDate: "2026-08-25",
    idempotencyKey: "saved-boundary-source",
    name: "Saved boundary tortilla",
    quantity: "1",
  });
  await expect(homeLoader(routeArgs(get("/?date=2026-08-25&food=saved:999999"))))
    .rejects.toMatchObject({ status: 404 });
  const wrongDay = await homeAction(routeArgs(post({
    date: "2026-08-26",
    entryId: String(source.id),
    intent: "save-manual-food",
  })));
  expect(wrongDay).toMatchObject({ init: { status: 404 } });

  const missingFood = await homeAction(routeArgs(post({
    date: "2026-08-25",
    idempotencyKey: "missing-saved-food",
    intent: "log-saved-food",
    savedFoodId: "999999",
  })));
  expect(missingFood).toMatchObject({ init: { status: 404 } });
  const invalidId = await homeAction(routeArgs(post({
    date: "2026-08-25",
    idempotencyKey: "invalid-saved-id",
    intent: "log-saved-food",
    savedFoodId: "invalid",
  })));
  expect(invalidId).toMatchObject({ init: { status: 400 } });
  const savedFoodId = getFoodEntryService(new Date(instant))
    .listSavedFoods(userId, "Saved boundary tortilla")[0].id;
  const reservedKey = await homeAction(routeArgs(post({
    date: "2026-08-25",
    idempotencyKey: `copy:${source.id}:reserved`,
    intent: "log-saved-food",
    savedFoodId: String(savedFoodId),
  })));
  expect(reservedKey).toMatchObject({ init: { status: 400 } });
  const future = await homeAction(routeArgs(post({
    date: "2026-09-01",
    idempotencyKey: "future-saved-food",
    intent: "log-saved-food",
    savedFoodId: String(savedFoodId),
  })));
  expect(future).toMatchObject({ init: { status: 422 } });
  const invalidUrl = await load("/?date=2026-08-25&food=saved:invalid");
  expect(invalidUrl.data.catalog).toBeUndefined();
});

test("copy loader restricts source actions and validates every calendar selection", async () => {
  const service = getFoodEntryService(new Date(instant));
  const source = await service.log(userId, {
    foodLogDate: "2026-08-23", idempotencyKey: "copy-loader-boundary-source",
    provider: "usda-fdc", providerFoodId: "1001", quantity: "1", selectedMeasurementId: "base:g:100000000",
  });
  await homeAction(routeArgs(post({ date: source.foodLogDate, intent: "create-water", waterSelection: "8" })));
  const historical = await load(`/?date=${source.foodLogDate}`);
  expect(Object.keys(historical.data.copyIdempotencyKeys)).toEqual([String(source.id)]);
  expect(historical.data.copyIdempotencyKeys[source.id]).toMatch(new RegExp(`^copy:${source.id}:`));
  expect(historical.data.copyDialog).toBeUndefined();
  expect(historical.data.copyError).toBeUndefined();
  for (const date of [today, "2026-09-01"]) {
    const current = await load(`/?date=${date}&copy=${source.id}`);
    expect(current.data.copyIdempotencyKeys).toEqual({});
    expect(current.data.copyDialog).toBeUndefined();
    expect(current.data.copyError).toBeUndefined();
  }
  for (const query of ["copy=invalid", "copy=0", `copy=${source.id}&date=2026-08-22`]) {
    const result = await load(`/?${query}${query.includes("date=") ? "" : `&date=${source.foodLogDate}`}`);
    expect(result.data).toMatchObject({ copyDialog: undefined, copyError: "That Food Entry is unavailable. Choose another entry." });
  }
  for (const copyDate of ["", "invalid", "2026-02-30", source.foodLogDate, "2026-09-01"]) {
    const result = await load(`/?date=${source.foodLogDate}&copy=${source.id}&copyDate=${copyDate}`);
    expect(result.data.copyDialog?.destinationDate).toBeUndefined();
    expect(result.data.copyDialog?.calendar.month).toBe("2026-08");
    expect(result.data.copyDialog?.calendar.days.some((day) => day.isSelected)).toBe(false);
  }
  const selected = await load(`/?date=${source.foodLogDate}&copy=${source.id}&copyDate=${today}`);
  expect(selected.data.copyDialog?.destinationDate).toBe(today);
  expect(selected.data.copyDialog?.calendar.days.filter((day) => day.isSource).map((day) => day.date)).toEqual([source.foodLogDate]);
  expect(selected.data.copyDialog?.calendar.days.filter((day) => day.isSelected).map((day) => day.date)).toEqual([today]);
  expect(selected.data.copyDialog?.calendar.days).toHaveLength(31);
  const previous = await load(`/?date=${source.foodLogDate}&copy=${source.id}&copyMonth=2026-07&copyDate=2026-07-15`);
  expect(previous.data.copyDialog?.calendar.month).toBe("2026-07");
  expect(previous.data.copyDialog?.calendar.days.filter((day) => day.isSelected).map((day) => day.date)).toEqual(["2026-07-15"]);
});

test("home lists accepted photo work and redirects attempts to open a processing entry", async () => {
  let finish!: (value: unknown) => void;
  const photoService = new PhotoAnalysisService(getApplicationDatabase().getClient(), { analyze: () => new Promise(resolve => { finish = resolve; }) }, { now: () => new Date(instant) });
  const photo = await photoService.start(userId, { photo: { mimeType: "image/png", bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFElEQVR4nGP4TyJgGNUwqmH4agAAr639H708R/EAAAAASUVORK5CYII=", "base64") }, foodLogDate: today, idempotencyKey: "home-photo-lifecycle" });
  expect((await load()).data.photoMeals).toMatchObject([{ id: photo.id, entryId: null, status: "active" }]);
  finish({ name: "Home rice", consumedFraction: 1, assumptions: [], components: [{ id: "rice", name: "Rice", quantity: 200, unit: "g", includes: [], source: { kind: "ai", reason: "No reference" }, nutrition: { energyKcal: 250, proteinGrams: 5, carbohydrateGrams: 50, fatGrams: 2 } }] });
  await expect.poll(() => photoService.status(userId, photo.id).status).toBe("succeeded");
  const entryId = photoService.status(userId, photo.id).entryId!;
  expect((await load(`/?date=${today}&entry=${entryId}`)).data.foodEntryEditor?.id).toBe(entryId);
  await photoService.correct(userId, entryId, { correction: "Butter", idempotencyKey: "home-photo-correction" });
  expectRedirect(await homeLoader(routeArgs(get(`/?date=${today}&entry=${entryId}`))), `/?date=${today}`);
  photoService.shutdown();
});

test.each([
  [new CatalogStaleReviewError(), 409, "Review food again"],
  [new CatalogNutritionUnavailableError(), 422, "Nutrition unavailable"],
] as const)("catalog review failures keep their HTTP status and review guidance %#", async (error, status, title) => {
  setFoodCatalogProviderForTests({
    async getFood() { throw error; },
    async search() { throw error; },
  });
  try {
    const message = error instanceof CatalogStaleReviewError ? error.message : "This food has no usable calories in the installed catalog.";
    const detail = await load("/?food=1001");
    expect(detail.data.catalog).toMatchObject({ title, message });
    const result = await homeAction(routeArgs(post({ intent: "log-food", idempotencyKey: "local-review-failure", providerFoodId: "1001", quantity: "1", selectedMeasurementId: "base:g:100000000" })));
    expect(result).toMatchObject({ data: { message }, init: { status } });
  } finally { setFoodCatalogProviderForTests(undefined); }
});
