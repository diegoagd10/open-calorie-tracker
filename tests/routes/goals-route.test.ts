import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { RouterContextProvider } from "react-router";
import { afterAll, beforeAll, expect, test } from "vitest";

import { serializeSessionCookie } from "../../app/auth/http.server";
import { getAuthenticationService } from "../../app/auth/runtime.server";
import {
  initializeApplicationDatabase,
  shutdownApplicationDatabase,
} from "../../app/database/runtime.server";
import {
  action as goalsAction,
  loader as goalsLoader,
} from "../../app/routes/settings.goals";
import { getGoalSetupService } from "../../app/setup/runtime.server";
import { validateSetupFields } from "../../app/setup/validation";

const origin = "http://localhost:3000";
const password = "correct horse battery staple";
let temporaryDirectory: string;
let databasePath: string;
let configuredCookie: string;
let configuredCsrf: string;
let incompleteCookie: string;
let incompleteCsrf: string;

function routeArgs(request: Request) {
  return {
    context: new RouterContextProvider(),
    params: {},
    pattern: "/settings/goals",
    request,
    url: new URL(request.url),
  };
}

function validFields(overrides: Record<string, string> = {}) {
  return new URLSearchParams({
    calories: "2000",
    carbohydrate: "210",
    csrfToken: configuredCsrf,
    displayUnits: "us",
    effectiveDate: "2026-09-01",
    fat: "65",
    fiber: "30",
    protein: "110",
    sodium: "2000",
    sugar: "45",
    water: "80",
    waterSourceUnits: "us",
    waterSourceValue: "80",
    ...overrides,
  });
}

function post(body: URLSearchParams, cookie = configuredCookie) {
  return new Request(`${origin}/settings/goals`, {
    body,
    headers: { Cookie: cookie, Origin: origin },
    method: "POST",
  });
}

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), "calory-goal-routes-"));
  process.env.APPLICATION_URL = origin;
  databasePath = path.join(temporaryDirectory, "application.sqlite");
  process.env.DATABASE_PATH = databasePath;
  process.env.FOOD_LOG_TEST_NOW = "2026-08-31T16:00:00.000Z";
  process.env.SETUP_TEST_NOW = "2026-08-31T16:00:00.000Z";
  initializeApplicationDatabase();

  const configured = await getAuthenticationService().register(
    "goals.route",
    password,
    "203.0.113.220",
  );
  if (!configured.ok) throw new Error("configured goal account was not created");
  configuredCookie = serializeSessionCookie(configured.session).split(";", 1)[0];
  configuredCsrf = configured.session.csrfToken;
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
  if (!setup.success) throw new Error("goal setup fixture was invalid");
  getGoalSetupService().completeInitial(configured.session.user.id, setup.data);

  const incomplete = await getAuthenticationService().register(
    "goals.incomplete",
    password,
    "203.0.113.221",
  );
  if (!incomplete.ok) throw new Error("incomplete goal account was not created");
  incompleteCookie = serializeSessionCookie(incomplete.session).split(";", 1)[0];
  incompleteCsrf = incomplete.session.csrfToken;
});

afterAll(async () => {
  shutdownApplicationDatabase();
  await rm(temporaryDirectory, { force: true, recursive: true });
  delete process.env.APPLICATION_URL;
  delete process.env.DATABASE_PATH;
  delete process.env.FOOD_LOG_TEST_NOW;
  delete process.env.SETUP_TEST_NOW;
});

test("goals loader enforces authentication, setup, and valid effective dates", async () => {
  const anonymous = await goalsLoader(
    routeArgs(new Request(`${origin}/settings/goals`)),
  );
  expect(anonymous).toBeInstanceOf(Response);
  expect((anonymous as Response).headers.get("Location")).toBe("/login");

  const incomplete = await goalsLoader(
    routeArgs(
      new Request(`${origin}/settings/goals`, {
        headers: { Cookie: incompleteCookie },
      }),
    ),
  );
  expect(incomplete).toBeInstanceOf(Response);
  expect((incomplete as Response).headers.get("Location")).toBe("/setup");

  const malformed = await goalsLoader(
    routeArgs(
      new Request(`${origin}/settings/goals?effectiveDate=not-a-date`, {
        headers: { Cookie: configuredCookie },
      }),
    ) as never,
  ).catch((error: unknown) => error);
  expect(malformed).toBeInstanceOf(Response);
  expect((malformed as Response).status).toBe(400);
  await expect((malformed as Response).text()).resolves.toBe(
    "Effective date must be today or a future local date.",
  );

  const loaded = await goalsLoader(
    routeArgs(
      new Request(`${origin}/settings/goals?effectiveDate=2026-09-01`, {
        headers: { Cookie: configuredCookie },
      }),
    ),
  );
  expect(loaded).not.toBeInstanceOf(Response);
  if (loaded instanceof Response) throw new Error("configured goals redirected");
  expect(loaded).toMatchObject({
    csrfToken: configuredCsrf,
    displayUnits: "us",
    fields: {
      calories: "2050",
      effectiveDate: "2026-09-01",
      water: "80",
    },
    timeZone: "America/New_York",
    today: "2026-08-31",
    username: "goals.route",
  });
});

test("goals loader does not disguise unexpected storage failures as bad dates", async () => {
  const database = new BetterSqlite3(databasePath);
  database.prepare(
    `UPDATE user_preferences
     SET time_zone = 'not/a-zone'
     WHERE user_id = (
       SELECT id FROM users WHERE username_normalized = 'goals.route'
     )`,
  ).run();
  try {
    const result = await goalsLoader(
      routeArgs(
        new Request(`${origin}/settings/goals`, {
          headers: { Cookie: configuredCookie },
        }),
      ) as never,
    ).catch((error: unknown) => error);
    expect(result).toBeInstanceOf(RangeError);
  } finally {
    database.prepare(
      `UPDATE user_preferences
       SET time_zone = 'America/New_York'
       WHERE user_id = (
         SELECT id FROM users WHERE username_normalized = 'goals.route'
       )`,
    ).run();
    database.close();
  }
});

test("goals action enforces origin, session, and CSRF", async () => {
  const wrongOrigin = await goalsAction(
    routeArgs(
      new Request(`${origin}/settings/goals`, {
        body: validFields(),
        headers: { Cookie: configuredCookie, Origin: "https://attacker.example" },
        method: "POST",
      }),
    ) as never,
  ).catch((error: unknown) => error);
  expect(wrongOrigin).toBeInstanceOf(Response);
  expect((wrongOrigin as Response).status).toBe(403);

  const anonymous = await goalsAction(
    routeArgs(post(validFields(), "")),
  );
  expect(anonymous).toBeInstanceOf(Response);
  expect((anonymous as Response).headers.get("Location")).toBe("/login");
  expect((anonymous as Response).headers.get("Set-Cookie")).toContain("Max-Age=0");

  const invalidCsrf = await goalsAction(
    routeArgs(post(validFields({ csrfToken: "wrong" }))) as never,
  ).catch((error: unknown) => error);
  expect(invalidCsrf).toBeInstanceOf(Response);
  expect((invalidCsrf as Response).status).toBe(403);
  await expect((invalidCsrf as Response).text()).resolves.toBe(
    "CSRF token rejected.",
  );

  const incomplete = await goalsAction(
    routeArgs(
      post(
        validFields({ csrfToken: incompleteCsrf }),
        incompleteCookie,
      ),
    ),
  );
  expect(incomplete).toBeInstanceOf(Response);
  expect((incomplete as Response).headers.get("Location")).toBe("/setup");
});

test("goals action reports validation and domain date failures", async () => {
  const invalidField = await goalsAction(
    routeArgs(post(validFields({ protein: "" }))),
  );
  expect(invalidField).toMatchObject({
    data: {
      error: "Protein must be from 0.001 to 2,000 g.",
      field: "protein",
    },
    init: { status: 400 },
  });

  const pastDate = await goalsAction(
    routeArgs(post(validFields({ effectiveDate: "2026-08-30" }))),
  );
  expect(pastDate).toMatchObject({
    data: {
      error: "Effective date must be today or a future local date.",
      field: "effectiveDate",
    },
    init: { status: 400 },
  });
});

test("goals action honors the effective-date context and propagates unknown writes", async () => {
  const invalidContextRequest = post(validFields());
  const invalidContextUrl = `${origin}/settings/goals?effectiveDate=not-a-date`;
  const invalidContext = new Request(invalidContextUrl, {
    body: await invalidContextRequest.text(),
    headers: invalidContextRequest.headers,
    method: "POST",
  });
  const contextFailure = await goalsAction(
    routeArgs(invalidContext) as never,
  ).catch((error: unknown) => error);
  expect(contextFailure).toBeInstanceOf(Error);
  expect((contextFailure as Error).message).toBe(
    "Effective date must be today or a future local date.",
  );

  const database = new BetterSqlite3(databasePath);
  database.exec(
    `CREATE TRIGGER reject_goal_route
     BEFORE INSERT ON goal_versions
     WHEN NEW.effective_date = '2026-09-02'
     BEGIN
       SELECT RAISE(ABORT, 'unexpected goal write failure');
     END`,
  );
  database.close();
  try {
    const writeFailure = await goalsAction(
      routeArgs(
        post(validFields({ effectiveDate: "2026-09-02" })),
      ) as never,
    ).catch((error: unknown) => error);
    expect(writeFailure).toBeInstanceOf(Error);
    expect((writeFailure as Error).message).toContain(
      "unexpected goal write failure",
    );
  } finally {
    const cleanup = new BetterSqlite3(databasePath);
    cleanup.exec("DROP TRIGGER reject_goal_route");
    cleanup.close();
  }
});

test("goals action creates and replaces complete versions", async () => {
  const created = await goalsAction(
    routeArgs(post(validFields())),
  );
  expect(created).toMatchObject({
    data: { message: "Goal Version saved for September 1, 2026." },
  });

  const replaced = await goalsAction(
    routeArgs(post(validFields({ calories: "1900" }))),
  );
  expect(replaced).toMatchObject({
    data: { message: "Goal Version replaced for September 1, 2026." },
  });
});
