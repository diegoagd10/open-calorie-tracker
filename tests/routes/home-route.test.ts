import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { RouterContextProvider } from "react-router";
import { afterAll, beforeAll, expect, test } from "vitest";

import { serializeSessionCookie } from "../../app/auth/http.server";
import { getAuthenticationService } from "../../app/auth/runtime.server";
import { setFoodCatalogProviderForTests } from "../../app/catalog/runtime.server";
import { CatalogFoodNotFoundError } from "../../app/catalog/food-catalog.server";
import {
  initializeApplicationDatabase,
  shutdownApplicationDatabase,
} from "../../app/database/runtime.server";
import {
  action as homeAction,
  headers,
  loader as homeLoader,
  meta,
} from "../../app/routes/home";
import { getFoodEntryService } from "../../app/food-entry/runtime.server";
import { getFoodLogService } from "../../app/food-log/runtime.server";
import { getGoalSetupService } from "../../app/setup/runtime.server";
import { validateSetupFields } from "../../app/setup/validation";
import { getWaterEventService } from "../../app/water-event/runtime.server";

const origin = "http://localhost:3000";
const instant = "2026-08-31T16:00:00.000Z";
const today = "2026-08-31";
let temporaryDirectory: string;
let cookie: string;
let csrfToken: string;
let incompleteCookie: string;

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

  const incomplete = await getAuthenticationService().register(
    "home.incomplete",
    "correct horse battery staple",
    "203.0.113.231",
  );
  if (!incomplete.ok) throw new Error("incomplete home account was not created");
  incompleteCookie = serializeSessionCookie(incomplete.session).split(";", 1)[0];
});

afterAll(async () => {
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
    { title: "Open Calory Tracker · Private application" },
    {
      content: "Your private Open Calory Tracker application space",
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
    ["water-created", "Water Event added. Daily total updated."],
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
  expect(empty.data.catalog).toEqual({ mode: "search", query: "", results: [] });

  const invalid = await load("/?food=search&query=a");
  expect(invalid.init?.status).toBe(400);
  expect(invalid.data.catalog).toEqual({
    message: "Enter a food search from 2 to 100 characters.",
    mode: "search",
    query: "a",
    results: [],
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

  for (const [query, status, title, message] of [
    [
      "configuration",
      503,
      "USDA search is not configured",
      "USDA search is not configured. Your saved Food Entries remain available.",
    ],
    [
      "credentials",
      503,
      "USDA credentials unavailable",
      "USDA search credentials are unavailable. Your saved Food Entries remain available.",
    ],
    [
      "rate",
      429,
      "USDA rate limit reached",
      "USDA rate limit reached. Wait a moment and search again.",
    ],
    [
      "malformed",
      502,
      "USDA response could not be used",
      "USDA returned food data that could not be used safely.",
    ],
    [
      "unavailable",
      503,
      "USDA is unavailable",
      "USDA is unavailable right now. Your saved Food Entries are unaffected.",
    ],
  ] as const) {
    const result = await load(`/?food=search&query=${query}`);
    expect(result.init?.status).toBe(status);
    expect(result.data.catalog).toMatchObject({
      mode: "search",
      message,
      query,
      results: [],
      title,
    });
  }

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
    "/?date=2026-08-31&food=search",
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
  expectRedirect(created, "/?date=2026-08-31&notice=water-created");
  const preset = await homeAction(
    routeArgs(post({ intent: "create-water", waterSelection: "16" })),
  );
  expectRedirect(preset, "/?date=2026-08-31&notice=water-created");
  for (const waterSelection of ["8", "24"]) {
    expectRedirect(
      await homeAction(routeArgs(post({ intent: "create-water", waterSelection }))),
      "/?date=2026-08-31&notice=water-created",
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
  expectRedirect(previous, "/?date=2026-08-30&notice=water-created");
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
