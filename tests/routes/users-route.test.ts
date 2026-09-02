import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { eq } from "drizzle-orm";
import { RouterContextProvider } from "react-router";
import { afterAll, beforeAll, expect, test } from "vitest";

import { serializeSessionCookie } from "../../app/auth/http.server";
import { getAuthenticationService } from "../../app/auth/runtime.server";
import {
  getApplicationDatabase,
  initializeApplicationDatabase,
  shutdownApplicationDatabase,
} from "../../app/database/runtime.server";
import { passwordCredentials, users } from "../../app/database/schema.server";
import {
  action as usersAction,
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

function post(fields: Record<string, string>, cookie = administratorCookie) {
  return new Request(`${origin}/settings/users`, {
    body: new URLSearchParams(fields),
    headers: { Cookie: cookie, Origin: origin },
    method: "POST",
  });
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
      passwordChangeRequired: false,
      username: "alpha.member",
    },
    {
      accessState: "active",
      createdAt: "2026-08-29T11:00:00.000Z",
      passwordChangeRequired: false,
      username: "regular.member",
    },
    {
      accessState: "disabled",
      createdAt: "2026-08-31T10:00:00.000Z",
      passwordChangeRequired: false,
      username: "zebra.member",
    },
  ]);
  expect(administrator.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect(administrator.username).toBe("sole.admin");
});

test("member directory responses are not stored", () => {
  expect(headers()).toEqual({ "Cache-Control": "no-store" });
});

test("administrator provisions a normalized restricted member through the Users route", async () => {
  const administrator = await getAuthenticationService().authenticate(
    administratorCookie.split("=", 2)[1],
  );
  if (!administrator) throw new Error("administrator session was unavailable");
  const initialPassword = "temporary account passphrase";

  const created = await usersAction(
    routeArgs(
      post({
        confirmPassword: initialPassword,
        csrfToken: administrator.csrfToken,
        password: initialPassword,
        username: "NEW.Member",
      }),
    ),
  );

  expect(created).toMatchObject({
    data: { createdUsername: "new.member" },
    init: { status: 201 },
  });
  expect(JSON.stringify(created)).not.toContain(initialPassword);
  expect(
    getApplicationDatabase()
      .getClient()
      .select({
        passwordChangeRequired: users.passwordChangeRequired,
        passwordHash: passwordCredentials.passwordHash,
        username: users.usernameNormalized,
      })
      .from(users)
      .innerJoin(passwordCredentials, eq(passwordCredentials.userId, users.id))
      .all(),
  ).toContainEqual({
    passwordChangeRequired: true,
    passwordHash: expect.stringMatching(/^argon2id\$v=1\$/) as unknown,
    username: "new.member",
  });

  const directory = await usersLoader(
    routeArgs(
      new Request(`${origin}/settings/users`, {
        headers: { Cookie: administratorCookie },
      }),
    ),
  );
  expect(directory.members).toContainEqual({
    accessState: "active",
    createdAt: expect.any(String) as unknown,
    passwordChangeRequired: true,
    username: "new.member",
  });
});

test("member provisioning rejects duplicate, malformed, unauthorized, CSRF-invalid, and Origin-invalid requests atomically", async () => {
  const authentication = getAuthenticationService();
  const administrator = await authentication.authenticate(
    administratorCookie.split("=", 2)[1],
  );
  const member = await authentication.authenticate(memberCookie.split("=", 2)[1]);
  if (!administrator || !member) throw new Error("route sessions unavailable");
  const before = authentication.listManageableMembers().length;
  const initialPassword = "temporary account passphrase";

  const duplicate = await usersAction(
    routeArgs(
      post({
        confirmPassword: initialPassword,
        csrfToken: administrator.csrfToken,
        password: initialPassword,
        username: "NEW.Member",
      }),
    ),
  );
  expect(duplicate).toMatchObject({
    data: { error: "That username is already in use." },
    init: { status: 409 },
  });

  const malformed = await usersAction(
    routeArgs(
      post({
        confirmPassword: initialPassword,
        csrfToken: administrator.csrfToken,
        password: initialPassword,
        username: "not a username",
      }),
    ),
  );
  expect(malformed).toMatchObject({ init: { status: 400 } });

  const unauthorized = await usersAction(
    routeArgs(
      post(
        {
          confirmPassword: initialPassword,
          csrfToken: member.csrfToken,
          password: initialPassword,
          username: "unauthorized.member",
        },
        memberCookie,
      ),
    ) as never,
  ).catch((error: unknown) => error);
  expect(unauthorized).toBeInstanceOf(Response);
  expect((unauthorized as Response).status).toBe(404);

  const anonymous = await usersAction(
    routeArgs(
      post(
        {
          confirmPassword: initialPassword,
          csrfToken: "anonymous",
          password: initialPassword,
          username: "anonymous.member",
        },
        "",
      ),
    ) as never,
  ).catch((error: unknown) => error);
  expect(anonymous).toBeInstanceOf(Response);
  expect((anonymous as Response).headers.get("Location")).toBe("/login");

  const invalidCsrf = await usersAction(
    routeArgs(
      post({
        confirmPassword: initialPassword,
        csrfToken: "invalid",
        password: initialPassword,
        username: "csrf.member",
      }),
    ) as never,
  ).catch((error: unknown) => error);
  expect(invalidCsrf).toBeInstanceOf(Response);
  expect((invalidCsrf as Response).status).toBe(403);

  const invalidOriginRequest = post({
    confirmPassword: initialPassword,
    csrfToken: administrator.csrfToken,
    password: initialPassword,
    username: "origin.member",
  });
  invalidOriginRequest.headers.set("Origin", "https://attacker.example");
  const invalidOrigin = await usersAction(
    routeArgs(invalidOriginRequest) as never,
  ).catch((error: unknown) => error);
  expect(invalidOrigin).toBeInstanceOf(Response);
  expect((invalidOrigin as Response).status).toBe(403);

  expect(authentication.listManageableMembers()).toHaveLength(before);
  expect(authentication.listManageableMembers().map(({ username }) => username))
    .not.toEqual(expect.arrayContaining([
      "anonymous.member",
      "csrf.member",
      "origin.member",
      "unauthorized.member",
    ]));
});
