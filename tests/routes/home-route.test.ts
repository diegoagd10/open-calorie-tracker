import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { RouterContextProvider } from "react-router";
import { afterAll, beforeAll, expect, test, vi } from "vitest";

import { serializeSessionCookie } from "../../app/auth/http.server";
import { getAuthenticationService } from "../../app/auth/runtime.server";
import {
  CatalogFoodNotFoundError,
  CatalogStaleReviewError,
  CatalogNutritionUnavailableError,
} from "../../app/catalog/food-catalog.server";
import { getFoodCatalog, getOpenFoodFactsClient, setFoodCatalogProviderForTests } from "../../app/catalog/runtime.server";
import { TEST_CATALOG_GENERATION } from "../../app/catalog/test-fixture.server";
import {
  getApplicationDatabase,
  initializeApplicationDatabase,
  shutdownApplicationDatabase,
} from "../../app/database/runtime.server";
import type { FoodEvent } from "../../app/food-event/food-event.model";
import { favoriteFoods, foodEvents } from "../../app/food-event/food-event.schema.server";
import { action as foodAction } from "../../app/food-event/routes/web";
import {
  action as homeAction,
  headers,
  loader as homeLoader,
  meta,
} from "../../app/routes/home";
import { shutdownCredentialStorage } from "../../app/credentials/runtime.server";
import { getFoodEventService } from "../../app/food-event/runtime.server";
import { getFoodLogService } from "../../app/food-log/runtime.server";
import { completeTestSetup } from "../support/setup";
import { getWaterEventService } from "../../app/water-event/runtime.server";
import { action as waterAction } from "../../app/water-event/routes/web";
import { seedAuthenticatedAccount } from "../support/authentication";
import { fakeOffApi, offApiFixtureReplies } from "../support/off-api";

const origin = "http://localhost:3000";
const instant = "2026-08-31T16:00:00.000Z";
const today = "2026-08-31";
let temporaryDirectory: string;
let cookie: string;
let csrfToken: string;
let incompleteCookie: string;
let incompleteCsrfToken: string;
let otherUserId: number;
let userId: number;
let memberCookie: string;
const offReplies = offApiFixtureReplies();
const offApi = fakeOffApi(offReplies);

function routeArgs(request: Request) {
  return {
    context: new RouterContextProvider(),
    params: {},
    pattern: "/",
    request,
    url: new URL(request.url),
  };
}

function get(pathname = "/", sessionCookie = cookie) {
  return new Request(`${origin}${pathname}`, {
    headers: {
      Cookie: sessionCookie,
      "X-Test-Food-Log-Now": instant,
      "x-open-calory-request-id": "home-route-request",
    },
  });
}

function post(
  fields: Record<string, string>,
  options: { authenticated?: boolean; origin?: string; testInstant?: boolean } = {},
) {
  const body = new URLSearchParams({
    csrfToken,
    date: today,
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

async function load(pathname = "/", sessionCookie = cookie) {
  const result = await homeLoader(routeArgs(get(pathname, sessionCookie)));
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
  completeTestSetup(account.session.user.id);

  const incomplete = await seedAuthenticatedAccount(
    getAuthenticationService(),
    getApplicationDatabase().getClient(),
    "home.incomplete",
    "correct horse battery staple",
    "203.0.113.231",
  );
  incompleteCookie = serializeSessionCookie(incomplete).split(";", 1)[0];
  incompleteCsrfToken = incomplete.csrfToken;
  otherUserId = incomplete.user.id;

  const member = await seedAuthenticatedAccount(
    getAuthenticationService(),
    getApplicationDatabase().getClient(),
    "home.member",
    "correct horse battery staple",
    "203.0.113.232",
  );
  memberCookie = serializeSessionCookie(member).split(";", 1)[0];
  completeTestSetup(member.user.id);

  vi.stubGlobal("fetch", offApi.fetch);
  getOpenFoodFactsClient().saveContact("family@example.com");
});

afterAll(async () => {
  vi.unstubAllGlobals();
  shutdownCredentialStorage();
  shutdownApplicationDatabase();
  await rm(temporaryDirectory, { force: true, recursive: true });
  for (const name of [
    "APPLICATION_URL",
    "DATABASE_PATH",
    "FOOD_CATALOG_TEST_FIXTURE",
    "FOOD_LOG_TEST_NOW",
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
  expect(base.data.addFood).toBeUndefined();
  expect(base.data.copy).toBeUndefined();
  expect(base.data.editor).toBeUndefined();
  expect(base.data).toMatchObject({
    calendar: undefined,
    csrfToken,
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
    ["updated", undefined],
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
  expect(empty.data.addFood).toEqual({ mode: "search", query: "", results: [], favorites: [] });

  const invalid = await load("/?food=search&query=a");
  expect(invalid.init?.status).toBe(400);
  expect(invalid.data.addFood).toEqual({
    message: "Enter a food search from 2 to 100 characters.",
    mode: "search",
    query: "a",
    results: [],
    favorites: [],
    title: "Search not sent",
  });

  const results = await load("/?food=search&query=yogurt");
  expect(results.init?.status).toBe(200);
  expect(results.data.addFood).toMatchObject({
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
    expect(boundary.data.addFood).toMatchObject({ query: expectedQuery });
  }

  for (const [query, status] of [
    ["not-installed", 503],
    ["malformed", 500],
    ["unavailable", 503],
  ] as const) {
    const result = await load(`/?food=search&query=${query}`);
    expect(result.init?.status).toBe(status);
    expect(result.data.addFood).toMatchObject({
      mode: "search",
      query,
      results: [],
    });
  }
  const packaged = await load("/?food=search&query=yogurt&filter=packaged");
  expect(packaged.data.addFood).toMatchObject({
    results: [{ provider: "usda-fdc", providerFoodId: "1001" }],
  });
  const packagedDetail = await load("/?food=0034000470693&provider=open-food-facts&query=example%20foods&filter=packaged");
  expect(packagedDetail.data.addFood).toMatchObject({
    food: { provider: "open-food-facts", providerFoodId: "0034000470693" },
    mode: "detail",
  });

  const detail = await load("/?food=1001&query=yogurt");
  expect(detail.data.addFood).toMatchObject({
    food: { name: "Plain nonfat Greek yogurt", providerFoodId: "1001" },
    mode: "detail",
    query: "yogurt",
  });

  const vanished = await load("/?food=4040&query=vanished");
  expect(vanished.init?.status).toBe(409);
  expect(vanished.data.addFood).toMatchObject({
    message:
      "USDA listed this food in search, but its details are no longer available. Choose another result.",
    mode: "search",
    query: "vanished",
    results: [{ providerFoodId: "1001" }],
    title: "Food no longer available",
  });

  const vanishedWithoutRefresh = await load("/?food=4040&query=unavailable");
  expect(vanishedWithoutRefresh.init?.status).toBe(409);
  if (vanishedWithoutRefresh.data.addFood?.mode !== "search") {
    throw new Error("Expected search fallback");
  }
  expect(vanishedWithoutRefresh.data.addFood.results).toEqual([]);
  const vanishedInvalidQuery = await load("/?food=4040&query=a");
  if (vanishedInvalidQuery.data.addFood?.mode !== "search") {
    throw new Error("Expected search fallback");
  }
  expect(vanishedInvalidQuery.data.addFood.results).toEqual([]);

  const unsafe = await load("/?food=9999&query=unsafe");
  expect(unsafe.init?.status).toBe(422);
  expect(unsafe.data.addFood).toMatchObject({
    message: "That food has no safe provider-backed measurement to log.",
    mode: "search",
    title: "Measurement unavailable",
  });

  const unavailable = await load("/?food=8888&query=yogurt");
  expect(unavailable.init?.status).toBe(503);
  expect(unavailable.data.addFood).toMatchObject({
    message: "USDA is unavailable right now. Your saved Food Entries are unaffected.",
    mode: "search",
    results: [],
    title: "USDA is unavailable",
  });

  const ignoredStage = await load("/?food=invalid&query=yogurt");
  expect(ignoredStage.data.addFood).toBeUndefined();
  for (const invalidFoodId of ["0", "01", "1x", "-1", "9007199254740992"]) {
    expect((await load(`/?food=${invalidFoodId}&query=yogurt`)).data.addFood)
      .toBeUndefined();
  }
  const futureStage = await load("/?date=2026-09-01&food=search&query=yogurt");
  expect(futureStage.data.addFood).toBeUndefined();
});

test("food search ignores unrelated and legacy URL parameters", async () => {
  const result = await load(
    `/?food=search&query=yogurt&provider=open-food-facts&filter=packaged&userId=${otherUserId}&barcode=0034000470693&unknown=ignored`,
  );

  expect(result.data.addFood).toMatchObject({
    mode: "search",
    query: "yogurt",
    results: [{
      name: "Plain nonfat Greek yogurt",
      provider: "usda-fdc",
      providerFoodId: "1001",
    }],
  });
  expect(result.data.addFood).not.toHaveProperty("filter");
  expect(result.data.addFood).not.toHaveProperty("provider");
});

test("missing USDA search returns a friendly user-safe response", async () => {
  const result = await load("/?food=search&query=not-installed");

  expect(result.init?.status).toBe(503);
  expect(result.data.addFood).toMatchObject({
    message:
      "USDA Foundation is not installed. Ask your administrator to install it in Food Catalogs Settings. Your saved Food Entries remain available.",
    mode: "search",
    query: "not-installed",
    results: [],
    title: "USDA Foundation is not installed",
  });
});

test("home loader exposes barcode lookup without creating a Food Event", async () => {
  const chooser = await load("/?food=choose");
  expect(chooser.data.addFood).toEqual({ mode: "choose" });

  const empty = await load("/?food=barcode");
  expect(empty.data.addFood).toEqual({
    barcode: "",
    mode: "barcode",
  });

  const invalid = await load("/?food=barcode&barcode=123");
  expect(invalid.init?.status).toBe(400);
  expect(invalid.data.addFood).toEqual({
    barcode: "123",
    message: "Enter a supported 7, 8, 12, 13, or 14 digit barcode.",
    mode: "barcode",
    title: "Barcode not valid",
  });

  for (const barcode of ["a1234567", "1234567a"]) {
    const malformed = await load(`/?food=barcode&barcode=${barcode}`);
    expect(malformed.init?.status).toBe(400);
  }
  const trimmed = await load("/?food=barcode&barcode=%201234567%20");
  expect(trimmed.data.addFood).toMatchObject({
    barcode: "1234567",
    mode: "barcode",
  });

  const found = await load("/?food=barcode&barcode=034000470693");
  expect(found.data.addFood).toMatchObject({
    barcode: "034000470693",
    food: {
      authoritativeBaseUnit: "g",
      barcode: "0034000470693",
      catalogGeneration: expect.stringMatching(/^[0-9a-f]{64}$/) as unknown,
      name: "Example cereal",
      provider: "open-food-facts",
      providerFoodId: "0034000470693",
      authoritativeBaseQuantityMicrounits: 30_000_000,
      brand: "Example Foods",
      dataType: "Open Food Facts",
      isSelectable: true,
      marketCountry: "United States",
      measurementSummary: "1 serving (30 g)",
      measurements: [
        {
          baseQuantityMicrounits: 30_000_000,
          id: "serving",
          label: "1 serving (30 g)",
          unit: "g",
        },
        { baseQuantityMicrounits: 1_000_000, id: "g", label: "1 g", unit: "g" },
        { baseQuantityMicrounits: 100_000_000, id: "100g", label: "100 g", unit: "g" },
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
  });
  expect(getFoodLogService().read(userId, today)?.foodEvents).toHaveLength(0);

  for (const [barcode, status, title, message] of [
    ["0000000000001", 404, "Product not found", "another code"],
    ["0000000000002", 404, "Product not found", "log it manually"],
    ["0000000000004", 503, "Open Food Facts isn't responding", "Try again or log it manually."],
    ["0000000000005", 503, "Open Food Facts isn't responding", "Try again or log it manually."],
  ] as const) {
    const result = await load(`/?food=barcode&barcode=${barcode}`);
    expect(result.init?.status).toBe(status);
    if (result.data.addFood?.mode !== "barcode") {
      throw new Error("Expected barcode state");
    }
    expect(result.data.addFood.barcode).toBe(barcode);
    expect(result.data.addFood.title).toBe(title);
    expect(result.data.addFood.message).toContain(message);
  }
});

test("home loader exposes a fresh manual food form without changing the log", async () => {
  const manual = await load("/?date=2026-08-30&food=manual");

  expect(manual.data.addFood).toEqual({ mode: "manual" });
  expect(getFoodLogService().read(userId, "2026-08-30")?.foodEvents).toHaveLength(0);
  expect((await load("/?date=2026-09-01&food=manual")).data.addFood)
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
    if (correlated.data.addFood?.mode !== "search") throw new Error("Expected search");
    expect(correlated.data.addFood.results).toEqual([]);
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

    const actionFailure = await postFood(logLookup()).catch((error: unknown) => error);
    expect(actionFailure).toBe(unexpected);
    expect(contexts.at(-1)).toBe("food-action-request");
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

test("Scan barcode is offered once a contact is set, set up by administrators and hidden from members until then", async () => {
  expect((await load("/?food=choose")).data.barcodeLookup).toBe("enabled");
  expect((await load("/?food=choose", memberCookie)).data.barcodeLookup).toBe("enabled");

  getOpenFoodFactsClient().removeContact();
  try {
    expect((await load("/?food=choose")).data.barcodeLookup).toBe("admin-setup");
    expect((await load("/?food=choose", memberCookie)).data.barcodeLookup).toBe("hidden");
    const requests = offApi.requests.length;
    for (const sessionCookie of [cookie, memberCookie]) {
      for (const pathname of ["/?food=barcode", "/?food=barcode&barcode=034000470693"]) {
        expectRedirect(await homeLoader(routeArgs(get(`${pathname}&date=${today}`, sessionCookie))), `/?date=${today}&food=choose`);
      }
    }
    const detail = await load("/?food=0034000470693&provider=open-food-facts");
    expect(detail.init?.status).toBe(503);
    expect(detail.data.addFood).toMatchObject({ mode: "barcode", title: "Barcode lookup isn't configured" });
    expect(offApi.requests).toHaveLength(requests);
  } finally {
    getOpenFoodFactsClient().saveContact("family@example.com");
  }
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

function postWater(
  fields: Record<string, string>,
  options: { cookie?: string; testInstant?: boolean } = {},
) {
  const headers = new Headers({ Cookie: options.cookie ?? cookie, Origin: origin });
  if (options.testInstant !== false) headers.set("X-Test-Food-Log-Now", instant);
  return waterAction(routeArgs(new Request(`${origin}/water-events`, {
    body: new URLSearchParams({ csrfToken, returnDate: today, ...fields }),
    headers,
    method: "POST",
  })));
}

async function rejectedWith(result: Promise<unknown>): Promise<Response> {
  const outcome = await result.catch((error: unknown) => error);
  expect(outcome).toBeInstanceOf(Response);
  return outcome as Response;
}

test("the web water route creates, edits, and deletes Water Events from the Food Log dialog", async () => {
  expectRedirect(
    await postWater({ intent: "save", localLogDate: "2026-08-31T09:15", ounces: "12.5" }),
    "/?date=2026-08-31",
  );
  expectRedirect(
    await postWater({ intent: "save", localLogDate: "2026-08-30T21:00", ounces: "9" }),
    "/?date=2026-08-30",
  );
  const loaded = await load();
  expect(loaded.data.foodLog.waterTotalOunces).toBe("12.5");
  const event = loaded.data.foodLog.waterEvents[0];
  expect(event).toMatchObject({ logDate: "2026-08-31T13:15:00.000Z", ounces: "12.5" });
  expect(loaded.data.foodLog.events.find((candidate) => candidate.kind === "water"))
    .toMatchObject({ id: event.id, logDate: "2026-08-31T13:15:00.000Z" });

  const rejected = (code: string) => ({ data: { error: code }, init: { status: 400 } });
  expect(await postWater({ intent: "save", localLogDate: "2026-08-31T11:00", ounces: "0" }))
    .toMatchObject(rejected("invalid_amount"));
  expect(await postWater({ intent: "save", localLogDate: "2026-08-31T12:06", ounces: "8" }))
    .toMatchObject(rejected("invalid_log_date"));
  expect(await postWater({ intent: "save", localLogDate: "not a time", ounces: "8" }))
    .toMatchObject(rejected("invalid_log_date"));

  expectRedirect(
    await postWater({ id: String(event.id), intent: "save", ounces: "10" }),
    "/?date=2026-08-31&notice=water-updated",
  );
  expect(getWaterEventService().read(userId, event.id)).toMatchObject({ logDate: event.logDate, ounces: "10" });
  expect(await postWater({ id: String(event.id), intent: "save", ounces: "501" }))
    .toMatchObject(rejected("invalid_amount"));
  expect((await rejectedWith(postWater({ id: "999999", intent: "save", ounces: "1" }))).status).toBe(404);

  for (const fields of <Record<string, string>[]>[
    { intent: "rename" },
    { intent: "save", returnDate: "2026-02-30" },
    { id: "01", intent: "save", ounces: "1" },
    { intent: "delete" },
  ]) {
    expect((await rejectedWith(postWater(fields))).status).toBe(400);
  }
  const unconfigured = await rejectedWith(postWater(
    { csrfToken: incompleteCsrfToken, intent: "save", localLogDate: "2026-08-31T09:00", ounces: "8" },
    { cookie: incompleteCookie },
  ));
  expect(unconfigured.status).toBe(409);
  expect((await rejectedWith(postWater({ csrfToken: "wrong", intent: "save" }))).status).toBe(403);
  const invalidInstant = await rejectedWith(waterAction(routeArgs(new Request(`${origin}/water-events`, {
    body: new URLSearchParams({ csrfToken, intent: "save", localLogDate: "2026-08-31T09:00", ounces: "8", returnDate: today }),
    headers: { Cookie: cookie, Origin: origin, "X-Test-Food-Log-Now": "not an instant" },
    method: "POST",
  }))));
  expect(invalidInstant.status).toBe(400);
  const unauthenticated = await waterAction(routeArgs(new Request(`${origin}/water-events`, {
    body: new URLSearchParams({ csrfToken, intent: "save", returnDate: today }),
    headers: { Origin: origin },
    method: "POST",
  })));
  expect((unauthenticated as Response).status).toBe(302);

  expectRedirect(
    await postWater({ eventIds: String(event.id), intent: "delete" }),
    "/?date=2026-08-31&notice=water-deleted",
  );
  expectRedirect(
    await postWater({ eventIds: String(event.id), intent: "delete" }),
    "/?date=2026-08-31&notice=water-deleted",
  );
  expect((await load()).data.foodLog.waterTotalOunces).toBe("0");

  const waterService = getWaterEventService();
  const originalSave = waterService.save.bind(waterService);
  const unexpected = new Error("unexpected water failure");
  waterService.save = () => {
    throw unexpected;
  };
  try {
    await expect(postWater(
      { intent: "save", localLogDate: "2026-08-31T09:15", ounces: "1" },
      { testInstant: false },
    )).rejects.toBe(unexpected);
  } finally {
    waterService.save = originalSave;
  }
});

test("saving a Water Event returns to the event's own Food Log day, not the dialog's returnDate", async () => {
  const lastNight = getWaterEventService().save(userId, { logDate: "2026-08-31T01:00:00Z", quantity: { ounces: "9" } });
  try {
    expectRedirect(
      await postWater({ id: String(lastNight.id), intent: "save", ounces: "10", returnDate: "2026-08-31" }),
      "/?date=2026-08-30&notice=water-updated",
    );
    expect(getWaterEventService().read(userId, lastNight.id).ounces).toBe("10");
  } finally {
    getWaterEventService().delete(userId, [lastNight.id]);
  }
});

test("the web water route answers 400 to a body that is not a form or repeats a field, writing nothing", async () => {
  const notAForm = await rejectedWith(waterAction(routeArgs(new Request(`${origin}/water-events`, {
    body: `csrfToken=${csrfToken}&intent=save`,
    headers: { Cookie: cookie, Origin: origin, "Content-Type": "text/plain", "X-Test-Food-Log-Now": instant },
    method: "POST",
  }))));
  expect(notAForm.status).toBe(400);
  const brokenMultipart = await rejectedWith(waterAction(routeArgs(new Request(`${origin}/water-events`, {
    body: "--boundary\r\nnot a part",
    headers: { Cookie: cookie, Origin: origin, "Content-Type": "multipart/form-data; boundary=boundary", "X-Test-Food-Log-Now": instant },
    method: "POST",
  }))));
  expect(brokenMultipart.status).toBe(400);

  const repeatedToken = new URLSearchParams({ csrfToken, intent: "save", localLogDate: "2026-08-31T09:00", ounces: "8", returnDate: today });
  repeatedToken.append("csrfToken", csrfToken);
  const repeated = await rejectedWith(waterAction(routeArgs(new Request(`${origin}/water-events`, {
    body: repeatedToken,
    headers: { Cookie: cookie, Origin: origin, "X-Test-Food-Log-Now": instant },
    method: "POST",
  }))));
  expect(repeated.status).toBe(400);
  expect((await load()).data.foodLog.waterEvents).toEqual([]);
});

test("the home loader opens the water dialog for a new event or an event on the selected day", async () => {
  const today8am = getWaterEventService().save(userId, { logDate: "2026-08-31T12:00:00Z", quantity: { ounces: "8" } });
  const yesterday = getWaterEventService().save(userId, { logDate: "2026-08-30T12:00:00Z", quantity: { ounces: "8" } });

  expect((await load("/?water=new")).data.waterDialog).toEqual({
    initialLocalLogDate: "2026-08-31T12:00",
    maxLocalLogDate: "2026-08-31T12:00",
  });
  expect((await load("/?date=2026-08-30&water=new")).data.waterDialog).toEqual({
    initialLocalLogDate: "2026-08-30T12:00",
    maxLocalLogDate: "2026-08-31T12:00",
  });
  expect((await load(`/?water=${today8am.id}`)).data.waterDialog).toMatchObject({
    event: { id: today8am.id, ounces: "8" },
  });
  expect((await load("/?date=2026-09-01&water=new")).data.waterDialog).toBeUndefined();

  for (const requested of [String(yesterday.id), "0", "01", "1x", "-1", "9007199254740992", "invalid"]) {
    const response = await rejectedWith(homeLoader(routeArgs(get(`/?water=${requested}`))));
    expect(response.status).toBe(404);
  }

  const waterService = getWaterEventService();
  const originalRead = waterService.read.bind(waterService);
  const unexpected = new Error("unexpected water read failure");
  waterService.read = () => {
    throw unexpected;
  };
  try {
    const request = new Request(`${origin}/?water=${today8am.id}`, { headers: { Cookie: cookie } });
    await expect(homeLoader(routeArgs(request))).rejects.toBe(unexpected);
  } finally {
    waterService.read = originalRead;
  }
  waterService.delete(userId, [today8am.id, yesterday.id]);
});

function postFood(
  fields: Record<string, string>,
  options: { cookie?: string; csrfToken?: string; testInstant?: boolean } = {},
) {
  const headers = new Headers({
    Cookie: options.cookie ?? cookie,
    Origin: origin,
    "x-open-calory-request-id": "food-action-request",
  });
  if (options.testInstant !== false) headers.set("X-Test-Food-Log-Now", instant);
  return foodAction(routeArgs(new Request(`${origin}/food-events`, {
    body: new URLSearchParams({ csrfToken: options.csrfToken ?? csrfToken, date: today, ...fields }),
    headers,
    method: "POST",
  })));
}

function logLookup(change: Record<string, string> = {}): Record<string, string> {
  return {
    intent: "log",
    measurementId: "base:g:100000000",
    method: "lookup",
    providerFoodId: "1001",
    quantity: "1",
    reviewVersion: TEST_CATALOG_GENERATION,
    ...change,
  };
}

function logManual(change: Record<string, string> = {}): Record<string, string> {
  return { energyKcal: "180", intent: "log", method: "manual", name: "Tortillas", quantity: "3", ...change };
}

function refused(status: number, code: string, message?: string) {
  return {
    data: message === undefined ? { code } : { code, message: expect.stringContaining(message) as unknown },
    init: { status },
  };
}

async function foodEventsOn(date: string): Promise<FoodEvent[]> {
  return (await load(`/?date=${date}`)).data.foodLog.foodEvents;
}

function saveLookup(logDate: string): Promise<FoodEvent> {
  return getFoodEventService(new Date(instant)).save(userId, {
    method: "lookup",
    logDate,
    providerFoodId: "1001",
    reviewVersion: TEST_CATALOG_GENERATION,
    measurementId: "base:g:100000000",
    quantity: "1",
  });
}

function saveManual(name: string, logDate: string, saveAsFavorite = false): Promise<FoodEvent> {
  return getFoodEventService(new Date(instant)).save(userId, {
    method: "manual",
    logDate,
    name,
    quantity: "2",
    nutrition: { energyKcal: "115" },
    saveAsFavorite,
  });
}

test("the web food route refuses forms the dialogs never send, and accounts without a session or setup", async () => {
  expect((await rejectedWith(postFood(logLookup(), { csrfToken: "wrong" }))).status).toBe(403);
  const unauthenticated = await foodAction(routeArgs(new Request(`${origin}/food-events`, {
    body: new URLSearchParams({ csrfToken, ...logLookup() }),
    headers: { Origin: origin },
    method: "POST",
  })));
  expect((unauthenticated as Response).status).toBe(302);
  const unconfigured = await rejectedWith(postFood(
    { ...logManual(), csrfToken: incompleteCsrfToken },
    { cookie: incompleteCookie, csrfToken: incompleteCsrfToken },
  ));
  expect(unconfigured.status).toBe(409);

  for (const fields of <Record<string, string>[]>[
    { intent: "rename" },
    logLookup({ method: "photo" }),
    { intent: "log", method: "favorite", favoriteId: "01" },
    logManual({ date: "2026-02-30" }),
    { intent: "update", id: "x", expectedUpdatedAt: instant },
    { intent: "delete", expectedUpdatedAt: instant },
    { intent: "copy", id: "1", destinationDate: "invalid" },
  ]) {
    expect((await rejectedWith(postFood(fields))).status).toBe(400);
  }
  const repeated = new URLSearchParams({ csrfToken, date: today, ...logManual() });
  repeated.append("name", "Second name");
  const repeatedField = await rejectedWith(foodAction(routeArgs(new Request(`${origin}/food-events`, {
    body: repeated,
    headers: { Cookie: cookie, Origin: origin, "X-Test-Food-Log-Now": instant },
    method: "POST",
  }))));
  expect(repeatedField.status).toBe(400);
  const invalidInstant = await rejectedWith(foodAction(routeArgs(new Request(`${origin}/food-events`, {
    body: new URLSearchParams({ csrfToken, date: today, ...logManual() }),
    headers: { Cookie: cookie, Origin: origin, "X-Test-Food-Log-Now": "not an instant" },
    method: "POST",
  }))));
  expect(invalidInstant.status).toBe(400);
  expect(await foodEventsOn(today)).toEqual([]);
});

test("the web food route saves reviewed USDA foods now or at noon on a past day, for the signed-in account only", async () => {
  expectRedirect(await postFood(logLookup({ userId: String(otherUserId) })), "/?date=2026-08-31");
  expectRedirect(await postFood(logLookup({ date: "2026-08-30" })), "/?date=2026-08-30");
  const [todayEvent] = await foodEventsOn(today);
  const [pastEvent] = await foodEventsOn("2026-08-30");
  expect(todayEvent).toMatchObject({ logDate: instant, name: "Plain nonfat Greek yogurt", nutrients: { energyMilliKcal: 59_000 } });
  expect(pastEvent.logDate).toBe("2026-08-30T16:00:00.000Z");
  expect(getApplicationDatabase().getClient().select({ userId: foodEvents.userId }).from(foodEvents).all())
    .toEqual([{ userId }, { userId }]);

  // A resubmitted form records the food again, as Water Events do.
  expectRedirect(await postFood(logLookup()), "/?date=2026-08-31");
  expect(await foodEventsOn(today)).toHaveLength(2);

  expect(await postFood(logLookup({ date: "2026-09-01" }))).toMatchObject(refused(422, "future_date"));
  expect(await postFood(logLookup({ quantity: "0" }))).toMatchObject(refused(400, "invalid_quantity"));
  expect(await postFood(logLookup({ reviewVersion: "00000000-0000-4000-8000-000000000002" })))
    .toMatchObject(refused(409, "catalog_changed", "Open the food again before saving"));
  for (const [providerFoodId, status, code, message] of [
    ["4040", 404, "food_not_found", "details are no longer available"],
    ["9999", 400, "invalid_measurement", "no safe provider-backed measurement"],
    ["8888", 503, "source_unavailable", "USDA is unavailable right now"],
  ] as const) {
    expect(await postFood(logLookup({ providerFoodId }))).toMatchObject(refused(status, code, message));
  }

  const foodService = getFoodEventService();
  const originalSave = foodService.save.bind(foodService);
  const unexpected = new Error("unexpected food failure");
  foodService.save = () => Promise.reject(unexpected);
  try {
    await expect(postFood(logLookup(), { testInstant: false })).rejects.toBe(unexpected);
  } finally {
    foodService.save = originalSave;
  }
  const client = getApplicationDatabase().getClient();
  client.delete(foodEvents).where(eq(foodEvents.userId, userId)).run();
});

test("the web food route saves a reviewed Open Food Facts product and explains every refusal", async () => {
  const reviewed = await getFoodCatalog().lookupBarcode("034000470693");
  const barcode = (change: Record<string, string> = {}) => ({
    intent: "log",
    measurementId: "serving",
    method: "barcode",
    providerFoodId: "0034000470693",
    quantity: "0.5",
    reviewVersion: reviewed.catalogGeneration!,
    ...change,
  });

  expectRedirect(await postFood(barcode({ energyKcal: "999999", name: "Browser-controlled name" })), "/?date=2026-08-31");
  expect((await foodEventsOn(today)).find((event) => event.source.provider === "open-food-facts")).toMatchObject({
    name: "Example cereal",
    measurement: { label: "1 serving (30 g)" },
    quantityMicrounits: 500_000,
    nutrients: { carbohydrateMilligrams: 12_000, energyMilliKcal: 90_000, fatMilligrams: 0, proteinMilligrams: null },
  });

  for (const [providerFoodId, status, code, message] of [
    ["0000000000001", 404, "food_not_found", "Product not found"],
    ["0000000000004", 503, "source_unavailable", "Open Food Facts isn't responding; try again or log it manually."],
    ["0034000470693", 409, "catalog_changed", "The product changed on Open Food Facts. Review it again before saving."],
  ] as const) {
    expect(await postFood(barcode({ providerFoodId, reviewVersion: "0".repeat(64), quantity: "1" })))
      .toMatchObject(refused(status, code, message));
  }
  const conflicting = await getFoodCatalog().lookupBarcode("0000000000007");
  expect(await postFood(barcode({ providerFoodId: "0000000000007", reviewVersion: conflicting.catalogGeneration! })))
    .toMatchObject(refused(422, "nutrition_unavailable", "no usable nutrition"));
  expect(await postFood(barcode({ measurementId: "100ml" })))
    .toMatchObject(refused(400, "invalid_measurement", "selected supported measurement"));
  expect(await postFood(barcode({ providerFoodId: "034000470693" })))
    .toMatchObject(refused(503, "source_unavailable", "could not be used safely"));

  getOpenFoodFactsClient().removeContact();
  try {
    expect(await postFood(barcode())).toMatchObject(refused(503, "barcode_not_configured", "Ask an administrator"));
  } finally {
    getOpenFoodFactsClient().saveContact("family@example.com");
  }
  getApplicationDatabase().getClient().delete(foodEvents).where(eq(foodEvents.userId, userId)).run();
});

test.each([
  [today, instant],
  ["2026-08-30", "2026-08-30T16:00:00.000Z"],
])("the editor edits and deletes the version it read on %s, and a conflict returns the current event", async (date, logDate) => {
  const food = await saveLookup(logDate);
  const editor = await load(`/?date=${date}&entry=${food.id}`);
  expect(editor.data.editor).toEqual({ event: food, canCopy: date < today });

  const common = {
    carbohydrateGrams: "3.5",
    date,
    energyKcal: "60",
    expectedUpdatedAt: food.updatedAt,
    fatGrams: "0",
    fiberGrams: "",
    id: String(food.id),
    intent: "update",
    measurementId: "base:g:100000000",
    name: "Edited yogurt",
    proteinGrams: "10.5",
    quantity: "1",
    sodiumMilligrams: "36",
    sugarGrams: "3.5",
  };
  expect(await postFood({ ...common, name: "" })).toMatchObject(refused(400, "invalid_input"));
  expect(await postFood({ ...common, energyKcal: "1.0009" })).toMatchObject(refused(400, "invalid_nutrition"));
  expect(await postFood({ ...common, expectedUpdatedAt: "2000-01-01T00:00:00.000Z" }))
    .toMatchObject({ data: { code: "edit_conflict", event: food }, init: { status: 409 } });

  expectRedirect(await postFood(common), `/?date=${date}`);
  const saved = (await load(`/?date=${date}`)).data;
  expect(saved.editor).toBeUndefined();
  expect(saved.notice).toBeUndefined();
  expect(saved.foodLog.selectedDate).toBe(date);
  const expectedEnergy = editor.data.foodLog.nutritionTotals.energyMilliKcal.known
    - (food.nutrients.energyMilliKcal ?? 0) + 60_000;
  expect(saved.foodLog.nutritionTotals.energyMilliKcal.known).toBe(expectedEnergy);
  expect(saved.dailyCalories[date].knownMilliKcal).toBe(expectedEnergy);
  const updated = (await load(`/?date=${date}&entry=${food.id}`)).data.editor!.event;
  expect(updated).toMatchObject({
    logDate: food.logDate,
    name: "Edited yogurt",
    nutrients: {
      carbohydrateMilligrams: 3_500,
      energyMilliKcal: 60_000,
      fatMilligrams: 0,
      fiberMilligrams: null,
      proteinMilligrams: 10_500,
      sodiumMilligrams: 36,
      sugarMilligrams: 3_500,
    },
  });

  const remove = { date, expectedUpdatedAt: updated.updatedAt, id: String(food.id), intent: "delete" };
  expect(await postFood({ ...remove, expectedUpdatedAt: food.updatedAt }))
    .toMatchObject({ data: { code: "edit_conflict", event: updated }, init: { status: 409 } });
  expect(await postFood({ ...remove, id: "999999" })).toMatchObject(refused(404, "not_found"));
  expectRedirect(await postFood(remove), `/?date=${date}&notice=deleted`);
  // An event deleted elsewhere closes the editor rather than offering a retry.
  expect(await postFood({ ...common, expectedUpdatedAt: updated.updatedAt })).toMatchObject(refused(404, "not_found"));
});

test("the editor opens only an owned event on the selected day", async () => {
  const yesterday = await saveLookup("2026-08-30T16:00:00.000Z");
  const todayEvent = await saveLookup(instant);
  for (const requested of [`${yesterday.id}`, `0${todayEvent.id}`, "invalid", "0", "01", "1x", "-1", "9007199254740992"]) {
    const response = await rejectedWith(homeLoader(routeArgs(get(`/?entry=${requested}`))));
    expect(response.status).toBe(404);
    await expect(response.text()).resolves.toBe("Food Entry is unavailable.");
  }
  expect((await load("/?date=2026-09-01&entry=1")).data.editor).toBeUndefined();

  const service = getFoodEventService();
  const originalRead = service.read.bind(service);
  const unexpected = new Error("unexpected food read failure");
  service.read = () => {
    throw unexpected;
  };
  try {
    const request = new Request(`${origin}/?entry=${todayEvent.id}`, { headers: { Cookie: cookie } });
    await expect(homeLoader(routeArgs(request))).rejects.toBe(unexpected);
  } finally {
    service.read = originalRead;
  }
  getFoodEventService().delete(userId, [yesterday, todayEvent].map((event) => ({ id: event.id, expectedUpdatedAt: event.updatedAt })));
});

test("copying an earlier day's food to today returns to the source day with a notice", async () => {
  const source = await saveLookup("2026-08-29T16:00:00.000Z");
  const copyFields = { date: "2026-08-29", id: String(source.id), intent: "copy" };

  const copied = await postFood(copyFields);
  const destination = (copied as Response).headers.get("Location")!;
  const destinationUrl = new URL(destination, origin);
  expect(destinationUrl.searchParams.get("date")).toBe("2026-08-29");
  expect(destinationUrl.searchParams.get("notice")).toBe("copied");
  expectRedirect(copied, destination);

  const sourcePage = await load(destination);
  expect(sourcePage.data.notice).toBe(`Copied ${source.name} to today's Food Log.`);
  expect(sourcePage.data.foodLog.foodEvents).toEqual([source]);
  expect(await foodEventsOn(today)).toEqual([expect.objectContaining({
    copiedFromId: source.id,
    logDate: instant,
    name: source.name,
  })]);

  const todayEvent = (await foodEventsOn(today))[0];
  for (const [fields, expected] of [
    [{ ...copyFields, id: "999999" }, refused(404, "not_found")],
    [{ ...copyFields, date: "2026-08-28" }, refused(404, "not_found")],
    [{ date: today, id: String(todayEvent.id), intent: "copy" }, refused(400, "invalid_input")],
    [{ ...copyFields, destinationDate: "2026-08-29" }, refused(400, "invalid_log_date")],
    [{ ...copyFields, destinationDate: "2026-09-01" }, refused(422, "future_date")],
  ] as const) {
    expect(await postFood(fields)).toMatchObject(expected);
  }

  expect((await load("/?date=2026-08-29&notice=copied&copied=999999")).data.notice).toBeUndefined();
  expect((await load(`/?date=2026-08-29&notice=copied&copied=${source.id}`)).data.notice).toBeUndefined();
  getFoodEventService().delete(userId, [source, todayEvent].map((event) => ({ id: event.id, expectedUpdatedAt: event.updatedAt })));
});

test("the copy dialog chooses an eligible date and copies once to noon on that day", async () => {
  const source = await saveLookup("2026-08-26T16:00:00.000Z");

  const opened = await load(`/?date=2026-08-26&copy=${source.id}`);
  expect(opened.data.copy).toMatchObject({ destinationDate: undefined, event: source, sourceDate: "2026-08-26" });
  const unavailable = await load("/?date=2026-08-26&copy=999999");
  expect(unavailable.data.copy).toBeUndefined();
  expect(unavailable.data.copyError).toBe("That Food Entry is unavailable. Choose another entry.");

  const selected = await load(`/?date=2026-08-26&copy=${source.id}&copyDate=2026-08-27`);
  expect(selected.data.copy?.destinationDate).toBe("2026-08-27");
  const copied = await postFood({ date: "2026-08-26", destinationDate: "2026-08-27", id: String(source.id), intent: "copy" });
  const destination = (copied as Response).headers.get("Location")!;
  expect((await load(destination)).data.notice).toBe(`Copied ${source.name} to Thursday, August 27, 2026.`);
  expect(await foodEventsOn("2026-08-27")).toEqual([expect.objectContaining({
    copiedFromId: source.id,
    logDate: "2026-08-27T16:00:00.000Z",
    name: source.name,
  })]);
});

test("a manual food is added to the selected day, and a refused one returns its code and message", async () => {
  expectRedirect(await postFood(logManual({ date: "2026-08-30", carbohydrateGrams: "36", sodiumMilligrams: "30" })), "/?date=2026-08-30");
  expect((await foodEventsOn("2026-08-30"))[0]).toMatchObject({
    logDate: "2026-08-30T16:00:00.000Z",
    name: "Tortillas",
    favoriteId: null,
    quantityMicrounits: 3_000_000,
    nutrients: { energyMilliKcal: 180_000, carbohydrateMilligrams: 36_000, sodiumMilligrams: 30, fatMilligrams: null },
    source: { provider: "manual" },
  });

  expect(await postFood(logManual({ energyKcal: "", name: "Incomplete tortilla" })))
    .toMatchObject(refused(400, "invalid_nutrition", "calories"));
  expect(await postFood(logManual({ date: "2026-09-01" }))).toMatchObject(refused(422, "future_date"));
  expect((await foodEventsOn(today)).some((event) => event.name === "Incomplete tortilla")).toBe(false);
});

test("past-day adds land at noon, newest save first", async () => {
  for (const name of ["Past lunch", "Past snack"]) {
    expectRedirect(await postFood(logManual({ date: "2026-08-20", name })), "/?date=2026-08-20");
  }
  expect((await foodEventsOn("2026-08-20")).map((event) => [event.name, event.logDate])).toEqual([
    ["Past snack", "2026-08-20T16:00:00.000Z"],
    ["Past lunch", "2026-08-20T16:00:00.000Z"],
  ]);
});

test("Save to My foods favorites a manual food only when checked, and My foods reuse it on the viewed day", async () => {
  expectRedirect(await postFood(logManual({ date: "2026-08-27", name: "Unsaved tortilla" })), "/?date=2026-08-27");
  expectRedirect(await postFood(logManual({ date: "2026-08-27", energyKcal: "100", name: "Mexican tortilla", quantity: "2", saveAsFavorite: "on" })), "/?date=2026-08-27");

  const myFoods = await load("/?date=2026-08-29&food=my");
  if (myFoods.data.addFood?.mode !== "my") throw new Error("My foods did not open");
  expect(myFoods.data.addFood.favorites.map((favorite) => favorite.name)).toContain("Mexican tortilla");
  expect(myFoods.data.addFood.favorites.map((favorite) => favorite.name)).not.toContain("Unsaved tortilla");
  const searched = await load("/?date=2026-08-29&food=search&query=tortilla");
  if (searched.data.addFood?.mode !== "search") throw new Error("Search did not open");
  expect(searched.data.addFood.favorites.map((favorite) => favorite.name)).toEqual(["Mexican tortilla"]);

  const favoriteId = myFoods.data.addFood.favorites.find((favorite) => favorite.name === "Mexican tortilla")!.id;
  const detail = await load(`/?date=2026-08-29&food=saved:${favoriteId}`);
  expect(detail.data.addFood).toMatchObject({
    mode: "saved",
    favorite: { name: "Mexican tortilla", snapshot: { nutrients: { energyMilliKcal: 100_000 } } },
  });

  expectRedirect(await postFood({ date: "2026-08-29", favoriteId: String(favoriteId), intent: "log", method: "favorite" }), "/?date=2026-08-29");
  expect(await foodEventsOn("2026-08-29")).toContainEqual(expect.objectContaining({
    favoriteId,
    name: "Mexican tortilla",
    nutrients: expect.objectContaining({ energyMilliKcal: 100_000 }) as unknown,
    quantityMicrounits: 2_000_000,
  }));
});

test("reused and copied favorites do not offer to save the same food again", async () => {
  const original = await saveManual("Linked tortilla QA", "2026-08-26T16:00:00.000Z", true);
  const service = getFoodEventService(new Date(instant));
  const reused = await service.save(userId, { method: "favorite", logDate: "2026-08-28T16:00:00.000Z", favoriteId: original.favoriteId! });
  expect((await load(`/?date=2026-08-28&entry=${reused.id}`)).data.editor?.event.favoriteId).toBe(original.favoriteId);
  const copied = service.copy(userId, { eventId: reused.id, sourceDate: "2026-08-28", logDate: "2026-08-29T16:00:00.000Z" });
  expect((await load(`/?date=2026-08-29&entry=${copied.id}`)).data.editor?.event.favoriteId).toBe(original.favoriteId);

  expectRedirect(
    await postFood({ date: "2026-08-28", id: String(reused.id), intent: "add-favorite" }),
    `/?date=2026-08-28&entry=${reused.id}&notice=food-saved`,
  );
  expect(service.findFavorites(userId, { query: "Linked tortilla QA" })).toHaveLength(1);
});

test("an older manual food joins My foods only through the editor's action", async () => {
  const source = await saveManual("Old manual flatbread", "2026-08-24T16:00:00.000Z");
  expect((await load(`/?date=2026-08-24&entry=${source.id}`)).data.editor?.event.favoriteId).toBeNull();
  expectRedirect(
    await postFood({ date: "2026-08-24", id: String(source.id), intent: "add-favorite" }),
    `/?date=2026-08-24&entry=${source.id}&notice=food-saved`,
  );
  expect((await load(`/?date=2026-08-24&entry=${source.id}&notice=food-saved`)).data).toMatchObject({
    editor: { event: { favoriteId: expect.any(Number) as unknown } },
    notice: "Added to My foods.",
  });
  expect((await load("/?date=2026-08-31&food=my&query=flatbread")).data.addFood).toMatchObject({
    mode: "my",
    favorites: [expect.objectContaining({ name: "Old manual flatbread" })],
  });

  const catalogEvent = await saveLookup("2026-08-24T17:00:00.000Z");
  expect(await postFood({ date: "2026-08-24", id: String(catalogEvent.id), intent: "add-favorite" }))
    .toMatchObject(refused(400, "invalid_input", "Only manual foods"));
  expect(await postFood({ date: "2026-08-24", id: "999999", intent: "add-favorite" })).toMatchObject(refused(404, "not_found"));
  expect(getApplicationDatabase().getClient().select().from(favoriteFoods).where(eq(favoriteFoods.sourceEventId, catalogEvent.id)).all())
    .toEqual([]);
});

test("My foods refuses missing favorites and future days", async () => {
  await expect(homeLoader(routeArgs(get("/?date=2026-08-25&food=saved:999999"))))
    .rejects.toMatchObject({ status: 404 });
  expect((await load("/?date=2026-08-25&food=saved:invalid")).data.addFood).toBeUndefined();
  expect(await postFood({ date: "2026-08-25", favoriteId: "999999", intent: "log", method: "favorite" }))
    .toMatchObject(refused(404, "not_found"));
  const source = await saveManual("Saved boundary tortilla", "2026-08-25T16:00:00.000Z", true);
  expect(await postFood({ date: "2026-09-01", favoriteId: String(source.favoriteId), intent: "log", method: "favorite" }))
    .toMatchObject(refused(422, "future_date"));
});

test("only an earlier day's editor offers copy, and the copy dialog validates every calendar selection", async () => {
  const source = await saveLookup("2026-08-23T16:00:00.000Z");
  getWaterEventService().save(userId, { logDate: "2026-08-23T16:00:00Z", quantity: { ounces: "8" } });
  expect((await load(`/?date=2026-08-23&entry=${source.id}`)).data.editor?.canCopy).toBe(true);
  const todayEvent = await saveLookup(instant);
  expect((await load(`/?entry=${todayEvent.id}`)).data.editor?.canCopy).toBe(false);
  for (const date of [today, "2026-09-01"]) {
    const current = await load(`/?date=${date}&copy=${source.id}`);
    expect(current.data.copy).toBeUndefined();
    expect(current.data.copyError).toBeUndefined();
  }
  for (const query of ["copy=invalid", "copy=0", `copy=${source.id}&date=2026-08-22`]) {
    const result = await load(`/?${query}${query.includes("date=") ? "" : "&date=2026-08-23"}`);
    expect(result.data.copy).toBeUndefined();
    expect(result.data.copyError).toBe("That Food Entry is unavailable. Choose another entry.");
  }
  for (const copyDate of ["", "invalid", "2026-02-30", "2026-08-23", "2026-09-01"]) {
    const result = await load(`/?date=2026-08-23&copy=${source.id}&copyDate=${copyDate}`);
    expect(result.data.copy?.destinationDate).toBeUndefined();
    expect(result.data.copy?.calendar.month).toBe("2026-08");
    expect(result.data.copy?.calendar.days.some((day) => day.isSelected)).toBe(false);
  }
  const selected = await load(`/?date=2026-08-23&copy=${source.id}&copyDate=${today}`);
  expect(selected.data.copy?.destinationDate).toBe(today);
  expect(selected.data.copy?.calendar.days.filter((day) => day.isSource).map((day) => day.date)).toEqual(["2026-08-23"]);
  expect(selected.data.copy?.calendar.days.filter((day) => day.isSelected).map((day) => day.date)).toEqual([today]);
  expect(selected.data.copy?.calendar.days).toHaveLength(31);
  const previous = await load(`/?date=2026-08-23&copy=${source.id}&copyMonth=2026-07&copyDate=2026-07-15`);
  expect(previous.data.copy?.calendar.month).toBe("2026-07");
  expect(previous.data.copy?.calendar.days.filter((day) => day.isSelected).map((day) => day.date)).toEqual(["2026-07-15"]);
});

test.each([
  [new CatalogStaleReviewError(), 409, "catalog_changed", "Review food again"],
  [new CatalogNutritionUnavailableError(), 422, "nutrition_unavailable", "Nutrition unavailable"],
] as const)("catalog review failures keep their HTTP status and review guidance %#", async (error, status, code, title) => {
  setFoodCatalogProviderForTests({
    async getFood() { throw error; },
    async search() { throw error; },
  });
  try {
    const message = error instanceof CatalogStaleReviewError ? error.message : "This food has no usable calories in the installed catalog.";
    const detail = await load("/?food=1001");
    expect(detail.init?.status).toBe(status);
    expect(detail.data.addFood).toMatchObject({ title, message });
    expect(await postFood(logLookup())).toMatchObject({ data: { code, message }, init: { status } });
  } finally { setFoodCatalogProviderForTests(undefined); }
});

test("the food read model ignores unknown providers and notices, and propagates unexpected read failures", async () => {
  expect((await load("/?food=1001&provider=elsewhere")).data.addFood).toBeUndefined();
  expect((await load("/?food=12&provider=open-food-facts")).data.addFood).toBeUndefined();
  expect((await load("/?notice=copied&copied=abc")).data.notice).toBeUndefined();

  // Without the test instant header, the loader uses the shared service, which this test replaces.
  const source = await saveLookup("2026-08-21T16:00:00.000Z");
  const service = getFoodEventService();
  const read = service.read.bind(service);
  const unexpected = new Error("unexpected food read failure");
  service.read = () => {
    throw unexpected;
  };
  try {
    for (const query of [`copy=${source.id}`, `notice=copied&copied=${source.id}`]) {
      const request = new Request(`${origin}/?date=2026-08-21&${query}`, { headers: { Cookie: cookie } });
      await expect(homeLoader(routeArgs(request))).rejects.toBe(unexpected);
    }
  } finally {
    service.read = read;
  }

  const catalog = getFoodCatalog();
  const lookupBarcode = catalog.lookupBarcode.bind(catalog);
  const lookupFailure = new Error("unexpected barcode failure");
  catalog.lookupBarcode = () => Promise.reject(lookupFailure);
  try {
    await expect(homeLoader(routeArgs(get("/?food=barcode&barcode=034000470693")))).rejects.toBe(lookupFailure);
  } finally {
    catalog.lookupBarcode = lookupBarcode;
  }
});
