import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import BetterSqlite3 from "better-sqlite3";
import { RouterContextProvider } from "react-router";
import { afterAll, beforeAll, expect, test } from "vitest";

import { serializeSessionCookie } from "../../app/auth/http.server";
import { getAuthenticationService } from "../../app/auth/runtime.server";
import { getDailyGoalService } from "../../app/daily-goal/index.server";
import {
  action as goalsAction,
  loader as goalsLoader,
} from "../../app/daily-goal/routes/settings.goals";
import {
  getApplicationDatabase,
  initializeApplicationDatabase,
  shutdownApplicationDatabase,
} from "../../app/database/runtime.server";
import { seedAuthenticatedAccount } from "../support/authentication";
import { completeTestSetup } from "../support/setup";

const origin = "http://localhost:3000";
const password = "correct horse battery staple";
let temporaryDirectory: string;
let databasePath: string;
let configuredUserId: number;
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
    calorieTarget: "2000",
    carbohydrateTarget: "210",
    csrfToken: configuredCsrf,
    fatTarget: "65",
    fiberTarget: "30",
    proteinTarget: "110.5",
    sodiumMaximum: "2000",
    sugarMaximum: "45",
    waterTarget: "64.25",
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
  configuredUserId = configured.session.user.id;
  configuredCookie = serializeSessionCookie(configured.session).split(";", 1)[0];
  configuredCsrf = configured.session.csrfToken;
  completeTestSetup(configuredUserId, { goal: { calorieTarget: 2_050_500, waterTarget: "67.628" } });

  const incomplete = await seedAuthenticatedAccount(
    getAuthenticationService(),
    getApplicationDatabase().getClient(),
    "goals.incomplete",
    password,
    "203.0.113.221",
  );
  incompleteCookie = serializeSessionCookie(incomplete).split(";", 1)[0];
  incompleteCsrf = incomplete.csrfToken;
});

afterAll(async () => {
  shutdownApplicationDatabase();
  await rm(temporaryDirectory, { force: true, recursive: true });
  delete process.env.APPLICATION_URL;
  delete process.env.DATABASE_PATH;
  delete process.env.FOOD_LOG_TEST_NOW;
  delete process.env.SETUP_TEST_NOW;
});

test("goals loader enforces authentication and setup, then shows only the Daily Goal targets", async () => {
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

  const loaded = await goalsLoader(
    routeArgs(
      new Request(`${origin}/settings/goals`, {
        headers: { Cookie: configuredCookie },
      }),
    ),
  );
  expect(loaded).toEqual({
    csrfToken: configuredCsrf,
    isAdministrator: true,
    today: "2026-08-31",
    username: "goals.route",
    values: {
      calorieTarget: "2050.5",
      waterTarget: "67.628",
      proteinTarget: "120",
      carbohydrateTarget: "230",
      fatTarget: "70",
      fiberTarget: "25",
      sugarMaximum: "50",
      sodiumMaximum: "2300",
    },
  });
});

test("goals action enforces origin, session, CSRF, and setup", async () => {
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

test.each([
  [{ proteinTarget: "" }, "proteinTarget", "Protein must be from 0.001 to 2,000 g."],
  [{ calorieTarget: "20000.001" }, "calorieTarget", "Calories must be from 0.001 to 20,000 kcal."],
  [{ waterTarget: "500.001" }, "waterTarget", "Water must be from 0.001 to 500 fl oz."],
  [{ waterTarget: "1.0005" }, "waterTarget", "Water must be from 0.001 to 500 fl oz."],
  [{ sodiumMaximum: "2000.5" }, "sodiumMaximum", "Sodium maximum must be from 1 to 100,000 mg."],
])("goals action rejects %o and keeps the saved goal", async (overrides, field, message) => {
  const before = getDailyGoalService().read(configuredUserId);
  const rejected = await goalsAction(routeArgs(post(validFields(overrides))));
  expect(rejected).toMatchObject({
    data: { error: { field, message } },
    init: { status: 400 },
  });
  expect(getDailyGoalService().read(configuredUserId)).toEqual(before);
});

test("goals action replaces the Daily Goal immediately", async () => {
  const saved = await goalsAction(routeArgs(post(validFields())));
  expect(saved).toMatchObject({
    data: { message: "Daily Goal saved. Every day now uses it." },
  });
  expect(getDailyGoalService().read(configuredUserId)).toMatchObject({
    calorieTarget: 2_000_000,
    waterTarget: "64.25",
    proteinTarget: 110_500,
    carbohydrateTarget: 210_000,
    fatTarget: 65_000,
    fiberTarget: 30_000,
    sugarMaximum: 45_000,
    sodiumMaximum: 2_000,
  });
});

test("goals action propagates unexpected write failures", async () => {
  const database = new BetterSqlite3(databasePath);
  database.exec(
    `CREATE TRIGGER reject_goal_route
     BEFORE UPDATE ON daily_goals
     WHEN NEW.calorie_target_milli_kcal = 1999000
     BEGIN
       SELECT RAISE(ABORT, 'unexpected goal write failure');
     END`,
  );
  database.close();
  try {
    const writeFailure = await goalsAction(
      routeArgs(post(validFields({ calorieTarget: "1999" }))) as never,
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
