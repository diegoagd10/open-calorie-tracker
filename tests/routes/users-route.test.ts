import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { RouterContextProvider } from "react-router";
import { afterAll, beforeAll, expect, test } from "vitest";

import { serializeSessionCookie } from "../../app/auth/http.server";
import { getAuthenticationService } from "../../app/auth/runtime.server";
import {
  getApplicationDatabase,
  initializeApplicationDatabase,
  shutdownApplicationDatabase,
} from "../../app/database/runtime.server";
import { users } from "../../app/database/schema.server";
import {
  headers,
  loader as usersLoader,
} from "../../app/routes/settings.users";
import { seedAuthenticatedAccount } from "../support/authentication";

const origin = "http://localhost:3000";
const password = "correct horse battery staple";
let temporaryDirectory: string;
let administratorCookie: string;
let memberCookie: string;

function routeArgs(request: Request) {
  return {
    context: new RouterContextProvider(),
    params: {},
    pattern: "/settings/users",
    request,
    url: new URL(request.url),
  };
}

async function captureUsersLoaderResult(request: Request) {
  return usersLoader(routeArgs(request) as never).catch(
    (error: unknown) => error,
  );
}

beforeAll(async () => {
  temporaryDirectory = await mkdtemp(path.join(tmpdir(), "calory-users-route-"));
  process.env.APPLICATION_URL = origin;
  process.env.DATABASE_PATH = path.join(temporaryDirectory, "application.sqlite");
  initializeApplicationDatabase();

  const authentication = getAuthenticationService();
  const administrator = await authentication.register(
    "sole.admin",
    password,
    "203.0.113.180",
  );
  if (!administrator.ok) throw new Error("administrator was not created");
  administratorCookie = serializeSessionCookie(administrator.session).split(
    ";",
    1,
  )[0];

  const database = getApplicationDatabase().getClient();
  const member = await seedAuthenticatedAccount(
    authentication,
    database,
    "regular.member",
    password,
    "203.0.113.181",
  );
  memberCookie = serializeSessionCookie(member).split(";", 1)[0];

  database.insert(users).values([
    {
      accessState: "disabled",
      createdAt: "2026-08-31T10:00:00.000Z",
      role: "member",
      usernameNormalized: "zebra.member",
    },
    {
      accessState: "active",
      createdAt: "2026-09-01T11:00:00.000Z",
      role: "member",
      usernameNormalized: "alpha.member",
    },
  ]).run();
});

afterAll(async () => {
  shutdownApplicationDatabase();
  await rm(temporaryDirectory, { force: true, recursive: true });
  delete process.env.APPLICATION_URL;
  delete process.env.DATABASE_PATH;
});

test("member directory authorizes anonymous, member, and administrator requests", async () => {
  const anonymous = await captureUsersLoaderResult(
    new Request(`${origin}/settings/users`),
  );
  expect(anonymous).toBeInstanceOf(Response);
  expect((anonymous as Response).status).toBe(302);
  expect((anonymous as Response).headers.get("Location")).toBe("/login");

  const member = await captureUsersLoaderResult(
    new Request(`${origin}/settings/users`, {
      headers: { Cookie: memberCookie },
    }),
  );
  expect(member).toBeInstanceOf(Response);
  expect((member as Response).status).toBe(404);
  await expect((member as Response).text()).resolves.toBe("Not Found");

  const administrator = await usersLoader(
    routeArgs(
      new Request(`${origin}/settings/users`, {
        headers: { Cookie: administratorCookie },
      }),
    ),
  );
  expect(Object.keys(administrator).sort()).toEqual([
    "csrfToken",
    "members",
    "today",
    "username",
  ]);
  expect(administrator.csrfToken).not.toBe("");
  expect(administrator.members).toEqual([
    {
      accessState: "active",
      createdAt: "2026-09-01T11:00:00.000Z",
      username: "alpha.member",
    },
    {
      accessState: "active",
      createdAt: "2026-08-29T11:00:00.000Z",
      username: "regular.member",
    },
    {
      accessState: "disabled",
      createdAt: "2026-08-31T10:00:00.000Z",
      username: "zebra.member",
    },
  ]);
  expect(administrator.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(administrator.username).toBe("sole.admin");
});

test("member directory responses are not stored", () => {
  expect(headers()).toEqual({ "Cache-Control": "no-store" });
});
