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
    body: new URLSearchParams({ intent: "create-member", ...fields }),
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
    "recoveryPublicUrl",
    "today",
  ]);
  expect(administrator.csrfToken).not.toBe("");
  expect(administrator.members).toEqual([
    {
      accessState: "active",
      createdAt: "2026-09-01T11:00:00.000Z",
      id: 4,
      passwordChangeRequired: false,
      username: "alpha.member",
    },
    {
      accessState: "active",
      createdAt: "2026-08-29T11:00:00.000Z",
      id: 2,
      passwordChangeRequired: false,
      username: "regular.member",
    },
    {
      accessState: "disabled",
      createdAt: "2026-08-31T10:00:00.000Z",
      id: 3,
      passwordChangeRequired: false,
      username: "zebra.member",
    },
  ]);
  expect(administrator.today).toMatch(/^\d{4}-\d{2}-\d{2}$/);
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
  expect(directory.members).toContainEqual(expect.objectContaining({
    accessState: "active",
    createdAt: expect.any(String) as unknown,
    passwordChangeRequired: true,
    username: "new.member",
  }));
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

  const unknownIntent = await usersAction(
    routeArgs(
      post({
        confirmPassword: initialPassword,
        csrfToken: administrator.csrfToken,
        intent: "forged-action",
        password: initialPassword,
        username: "forged.member",
      }),
    ),
  );
  expect(unknownIntent).toMatchObject({
    data: { error: "Unsupported action." },
    init: { status: 400 },
  });

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
      "forged.member",
      "origin.member",
      "unauthorized.member",
    ]));
});

test("administrator disables and reactivates a member through confirmed safe route actions", async () => {
  const authentication = getAuthenticationService();
  const administrator = await authentication.authenticate(
    administratorCookie.split("=", 2)[1],
  );
  const ordinaryMember = await authentication.authenticate(
    memberCookie.split("=", 2)[1],
  );
  if (!administrator || !ordinaryMember) {
    throw new Error("route sessions unavailable");
  }
  const initialPassword = "temporary route access passphrase";
  await expect(authentication.provisionMember("route.access", initialPassword))
    .resolves.toMatchObject({ ok: true });
  const firstDevice = await authentication.login(
    "route.access",
    initialPassword,
    "203.0.113.185",
  );
  const secondDevice = await authentication.login(
    "route.access",
    initialPassword,
    "203.0.113.186",
  );
  if (!firstDevice.ok || !secondDevice.ok) throw new Error("route login failed");

  const invalidOriginRequest = post({
    confirmationUsername: "route.access",
    csrfToken: administrator.csrfToken,
    intent: "disable-member",
    targetUsername: "route.access",
  });
  invalidOriginRequest.headers.set("Origin", "https://attacker.example");
  const invalidOrigin = await usersAction(
    routeArgs(invalidOriginRequest) as never,
  ).catch((error: unknown) => error);
  expect(invalidOrigin).toBeInstanceOf(Response);
  expect((invalidOrigin as Response).status).toBe(403);

  const invalidCsrf = await usersAction(
    routeArgs(post({
      confirmationUsername: "route.access",
      csrfToken: "invalid",
      intent: "disable-member",
      targetUsername: "route.access",
    })) as never,
  ).catch((error: unknown) => error);
  expect(invalidCsrf).toBeInstanceOf(Response);
  expect((invalidCsrf as Response).status).toBe(403);

  const unauthorized = await usersAction(
    routeArgs(post({
      confirmationUsername: "route.access",
      csrfToken: ordinaryMember.csrfToken,
      intent: "disable-member",
      targetUsername: "route.access",
    }, memberCookie)) as never,
  ).catch((error: unknown) => error);
  expect(unauthorized).toBeInstanceOf(Response);
  expect((unauthorized as Response).status).toBe(404);

  const mismatch = await usersAction(
    routeArgs(post({
      confirmationUsername: "Route.Access",
      csrfToken: administrator.csrfToken,
      intent: "disable-member",
      targetUsername: "route.access",
    })),
  );
  expect(mismatch).toMatchObject({
    data: { accessError: "Enter route.access exactly to confirm." },
    init: { status: 400 },
  });

  const stale = await usersAction(
    routeArgs(post({
      confirmationUsername: "missing.member",
      csrfToken: administrator.csrfToken,
      intent: "disable-member",
      targetUsername: "missing.member",
    })),
  );
  expect(stale).toMatchObject({ init: { status: 409 } });
  await expect(authentication.authenticate(firstDevice.session.token))
    .resolves.toBeDefined();
  await expect(authentication.authenticate(secondDevice.session.token))
    .resolves.toBeDefined();
  await expect(authentication.authenticate(ordinaryMember.token))
    .resolves.toBeDefined();

  const disabled = await usersAction(
    routeArgs(post({
      confirmationUsername: "route.access",
      csrfToken: administrator.csrfToken,
      intent: "disable-member",
      targetUsername: "route.access",
    })),
  );
  expect(disabled).toMatchObject({
    data: {
      accessChanged: { action: "disabled", username: "route.access" },
    },
    init: { status: 200 },
  });
  await expect(authentication.authenticate(firstDevice.session.token))
    .resolves.toBeUndefined();
  await expect(authentication.authenticate(secondDevice.session.token))
    .resolves.toBeUndefined();
  await expect(authentication.authenticate(ordinaryMember.token))
    .resolves.toBeDefined();

  const repeatedDisable = await usersAction(
    routeArgs(post({
      confirmationUsername: "route.access",
      csrfToken: administrator.csrfToken,
      intent: "disable-member",
      targetUsername: "route.access",
    })),
  );
  expect(repeatedDisable).toMatchObject({ init: { status: 409 } });

  const reactivated = await usersAction(
    routeArgs(post({
      csrfToken: administrator.csrfToken,
      intent: "reactivate-member",
      targetUsername: "route.access",
    })),
  );
  expect(reactivated).toMatchObject({
    data: {
      accessChanged: { action: "reactivated", username: "route.access" },
    },
    init: { status: 200 },
  });
  const repeatedReactivate = await usersAction(
    routeArgs(post({
      csrfToken: administrator.csrfToken,
      intent: "reactivate-member",
      targetUsername: "route.access",
    })),
  );
  expect(repeatedReactivate).toMatchObject({ init: { status: 409 } });
  await expect(
    authentication.login(
      "route.access",
      initialPassword,
      "203.0.113.187",
    ),
  ).resolves.toMatchObject({
    ok: true,
    session: { user: { passwordChangeRequired: true } },
  });
});

test("administrator resets a listed member password and revokes every open session", async () => {
  const authentication = getAuthenticationService();
  const administrator = await authentication.authenticate(
    administratorCookie.split("=", 2)[1],
  );
  if (!administrator) throw new Error("administrator session unavailable");
  const originalPassword = "original route member passphrase";
  const temporaryPassword = "temporary route reset passphrase";
  const firstDevice = await seedAuthenticatedAccount(
    authentication,
    getApplicationDatabase().getClient(),
    "route.reset",
    originalPassword,
    "203.0.113.191",
  );
  const secondDevice = await authentication.login(
    "route.reset",
    originalPassword,
    "203.0.113.192",
  );
  if (!secondDevice.ok) throw new Error("second member login failed");

  const reset = await usersAction(
    routeArgs(post({
      confirmPassword: temporaryPassword,
      csrfToken: administrator.csrfToken,
      intent: "reset-member-password",
      newPassword: temporaryPassword,
      targetUsername: "route.reset",
    })),
  );

  expect(reset).toMatchObject({
    data: { passwordResetUsername: "route.reset" },
    init: { status: 200 },
  });
  await expect(authentication.authenticate(firstDevice.token))
    .resolves.toBeUndefined();
  await expect(authentication.authenticate(secondDevice.session.token))
    .resolves.toBeUndefined();
  await expect(
    authentication.login(
      "route.reset",
      originalPassword,
      "203.0.113.193",
    ),
  ).resolves.toEqual({ error: "invalid-credentials", ok: false });
  await expect(
    authentication.login(
      "route.reset",
      temporaryPassword,
      "203.0.113.194",
    ),
  ).resolves.toMatchObject({
    ok: true,
    session: { user: { passwordChangeRequired: true } },
  });
  expect(authentication.listManageableMembers()).toContainEqual(expect.objectContaining({
    accessState: "active",
    createdAt: "2026-08-29T11:00:00.000Z",
    passwordChangeRequired: true,
    username: "route.reset",
  }));
  expect(JSON.stringify(reset)).not.toContain(temporaryPassword);
});

test("invalid password-reset requests preserve credentials and sessions", async () => {
  const authentication = getAuthenticationService();
  const administrator = await authentication.authenticate(
    administratorCookie.split("=", 2)[1],
  );
  const ordinaryMember = await authentication.authenticate(
    memberCookie.split("=", 2)[1],
  );
  if (!administrator || !ordinaryMember) {
    throw new Error("route sessions unavailable");
  }
  const target = await seedAuthenticatedAccount(
    authentication,
    getApplicationDatabase().getClient(),
    "protected.reset",
    "protected original passphrase",
    "203.0.113.197",
  );
  const credentialBefore = getApplicationDatabase()
    .getClient()
    .select({
      passwordChangeRequired: users.passwordChangeRequired,
      passwordHash: passwordCredentials.passwordHash,
    })
    .from(users)
    .innerJoin(passwordCredentials, eq(passwordCredentials.userId, users.id))
    .where(eq(users.usernameNormalized, "protected.reset"))
    .get();
  const resetFields = {
    confirmPassword: "replacement protected passphrase",
    csrfToken: administrator.csrfToken,
    intent: "reset-member-password",
    newPassword: "replacement protected passphrase",
    targetUsername: "protected.reset",
  };

  const shortPassword = await usersAction(routeArgs(post({
    ...resetFields,
    confirmPassword: "too short",
    newPassword: "too short",
  })));
  expect(shortPassword).toMatchObject({ init: { status: 400 } });

  const mismatch = await usersAction(routeArgs(post({
    ...resetFields,
    confirmPassword: "different protected passphrase",
  })));
  expect(mismatch).toMatchObject({
    data: { passwordResetError: "Passwords do not match." },
    init: { status: 400 },
  });

  const malformedTarget = await usersAction(routeArgs(post({
    ...resetFields,
    targetUsername: "Protected.Reset",
  })));
  expect(malformedTarget).toMatchObject({ init: { status: 409 } });

  const staleTarget = await usersAction(routeArgs(post({
    ...resetFields,
    targetUsername: "missing.reset",
  })));
  expect(staleTarget).toMatchObject({ init: { status: 409 } });

  const invalidCsrf = await usersAction(
    routeArgs(post({ ...resetFields, csrfToken: "invalid" })) as never,
  ).catch((error: unknown) => error);
  expect(invalidCsrf).toBeInstanceOf(Response);
  expect((invalidCsrf as Response).status).toBe(403);

  const invalidOriginRequest = post(resetFields);
  invalidOriginRequest.headers.set("Origin", "https://attacker.example");
  const invalidOrigin = await usersAction(
    routeArgs(invalidOriginRequest) as never,
  ).catch((error: unknown) => error);
  expect(invalidOrigin).toBeInstanceOf(Response);
  expect((invalidOrigin as Response).status).toBe(403);

  const unauthorized = await usersAction(
    routeArgs(post(
      { ...resetFields, csrfToken: ordinaryMember.csrfToken },
      memberCookie,
    )) as never,
  ).catch((error: unknown) => error);
  expect(unauthorized).toBeInstanceOf(Response);
  expect((unauthorized as Response).status).toBe(404);

  expect(
    getApplicationDatabase()
      .getClient()
      .select({
        passwordChangeRequired: users.passwordChangeRequired,
        passwordHash: passwordCredentials.passwordHash,
      })
      .from(users)
      .innerJoin(passwordCredentials, eq(passwordCredentials.userId, users.id))
      .where(eq(users.usernameNormalized, "protected.reset"))
      .get(),
  ).toEqual(credentialBefore);
  await expect(authentication.authenticate(target.token)).resolves.toBeDefined();
});

test("administrator permanently deletes a member through exact route confirmation", async () => {
  const authentication = getAuthenticationService();
  const administrator = await authentication.authenticate(
    administratorCookie.split("=", 2)[1],
  );
  if (!administrator) throw new Error("administrator session unavailable");
  await expect(authentication.provisionMember("route.delete", password))
    .resolves.toMatchObject({ ok: true });
  const member = await authentication.login(
    "route.delete",
    password,
    "203.0.113.191",
  );
  if (!member.ok) throw new Error("member login failed");

  const deleted = await usersAction(
    routeArgs(post({
      confirmationUsername: "route.delete",
      csrfToken: administrator.csrfToken,
      intent: "delete-member",
      targetUserId: String(member.session.user.id),
      targetUsername: "route.delete",
    })),
  );

  expect(deleted).toMatchObject({
    data: { deletedUsername: "route.delete" },
    init: { status: 200 },
  });
  expect(authentication.listManageableMembers()).not.toContainEqual(
    expect.objectContaining({ username: "route.delete" }),
  );
  await expect(authentication.authenticate(member.session.token))
    .resolves.toBeUndefined();
});

test("member deletion rejects unsafe route requests without changing the target", async () => {
  const authentication = getAuthenticationService();
  const administrator = await authentication.authenticate(
    administratorCookie.split("=", 2)[1],
  );
  const ordinaryMember = await authentication.authenticate(
    memberCookie.split("=", 2)[1],
  );
  if (!administrator || !ordinaryMember) {
    throw new Error("route sessions unavailable");
  }
  await expect(authentication.provisionMember("route.protected", password))
    .resolves.toMatchObject({ ok: true });
  const target = await authentication.login(
    "route.protected",
    password,
    "203.0.113.192",
  );
  if (!target.ok) throw new Error("target login failed");
  const targetUserId = String(target.session.user.id);

  const mismatch = await usersAction(routeArgs(post({
    confirmationUsername: "Route.Protected",
    csrfToken: administrator.csrfToken,
    intent: "delete-member",
    targetUserId,
    targetUsername: "route.protected",
  })));
  expect(mismatch).toMatchObject({ init: { status: 400 } });

  const missingConfirmation = await usersAction(routeArgs(post({
    csrfToken: administrator.csrfToken,
    intent: "delete-member",
    targetUserId,
    targetUsername: "route.protected",
  })));
  expect(missingConfirmation).toMatchObject({ init: { status: 400 } });

  const malformed = await usersAction(routeArgs(post({
    confirmationUsername: "not a username",
    csrfToken: administrator.csrfToken,
    intent: "delete-member",
    targetUserId,
    targetUsername: "not a username",
  })));
  expect(malformed).toMatchObject({ init: { status: 409 } });

  const stale = await usersAction(routeArgs(post({
    confirmationUsername: "missing.member",
    csrfToken: administrator.csrfToken,
    intent: "delete-member",
    targetUserId: "999999",
    targetUsername: "missing.member",
  })));
  expect(stale).toMatchObject({ init: { status: 409 } });

  const administratorTarget = await usersAction(routeArgs(post({
    confirmationUsername: "sole.admin",
    csrfToken: administrator.csrfToken,
    intent: "delete-member",
    targetUserId: String(administrator.user.id),
    targetUsername: "sole.admin",
  })));
  expect(administratorTarget).toMatchObject({ init: { status: 409 } });

  const invalidCsrf = await usersAction(
    routeArgs(post({
      confirmationUsername: "route.protected",
      csrfToken: "invalid",
      intent: "delete-member",
      targetUserId,
      targetUsername: "route.protected",
    })) as never,
  ).catch((error: unknown) => error);
  expect(invalidCsrf).toBeInstanceOf(Response);
  expect((invalidCsrf as Response).status).toBe(403);

  const invalidOriginRequest = post({
    confirmationUsername: "route.protected",
    csrfToken: administrator.csrfToken,
    intent: "delete-member",
    targetUserId,
    targetUsername: "route.protected",
  });
  invalidOriginRequest.headers.set("Origin", "https://attacker.example");
  const invalidOrigin = await usersAction(
    routeArgs(invalidOriginRequest) as never,
  ).catch((error: unknown) => error);
  expect(invalidOrigin).toBeInstanceOf(Response);
  expect((invalidOrigin as Response).status).toBe(403);

  const unauthorized = await usersAction(
    routeArgs(post({
      confirmationUsername: "regular.member",
      csrfToken: ordinaryMember.csrfToken,
      intent: "delete-member",
      targetUserId: String(ordinaryMember.user.id),
      targetUsername: "regular.member",
    }, memberCookie)) as never,
  ).catch((error: unknown) => error);
  expect(unauthorized).toBeInstanceOf(Response);
  expect((unauthorized as Response).status).toBe(404);

  expect(authentication.listManageableMembers()).toContainEqual(
    expect.objectContaining({ username: "route.protected" }),
  );
  await expect(authentication.authenticate(target.session.token))
    .resolves.toBeDefined();
  await expect(authentication.authenticate(ordinaryMember.token))
    .resolves.toBeDefined();
  await expect(authentication.authenticate(administrator.token))
    .resolves.toBeDefined();
});

test("a stale deletion form cannot delete a replacement account reusing the username", async () => {
  const authentication = getAuthenticationService();
  const administrator = await authentication.authenticate(
    administratorCookie.split("=", 2)[1],
  );
  if (!administrator) throw new Error("administrator session unavailable");
  await expect(authentication.provisionMember("stale.reused", password))
    .resolves.toMatchObject({ ok: true });
  const original = await authentication.login(
    "stale.reused",
    password,
    "203.0.113.196",
  );
  if (!original.ok) throw new Error("original login failed");
  await expect(authentication.deleteMember(
    administrator.user,
    { id: original.session.user.id, username: "stale.reused" },
    "stale.reused",
  )).resolves.toEqual({ ok: true });
  await expect(authentication.provisionMember("stale.reused", password))
    .resolves.toMatchObject({ ok: true });
  const replacement = await authentication.login(
    "stale.reused",
    password,
    "203.0.113.197",
  );
  if (!replacement.ok) throw new Error("replacement login failed");
  expect(replacement.session.user.id).not.toBe(original.session.user.id);

  const staleSubmission = await usersAction(routeArgs(post({
    confirmationUsername: "stale.reused",
    csrfToken: administrator.csrfToken,
    intent: "delete-member",
    targetUserId: String(original.session.user.id),
    targetUsername: "stale.reused",
  })));

  expect(staleSubmission).toMatchObject({ init: { status: 409 } });
  await expect(authentication.authenticate(replacement.session.token))
    .resolves.toBeDefined();
  expect(authentication.listManageableMembers()).toContainEqual(
    expect.objectContaining({ username: "stale.reused" }),
  );
});

test("member form validation returns actionable errors without changing the directory", async () => {
  const authentication = getAuthenticationService();
  const administrator = await authentication.authenticate(administratorCookie.split("=", 2)[1]);
  if (!administrator) throw new Error("administrator session unavailable");
  const csrfToken = administrator.csrfToken;
  const before = authentication.listManageableMembers();
  const unavailable = "Member is no longer available. Refresh and try again.";
  for (const [fields, error, status] of [
    [{ username: "a", password, confirmPassword: password }, "Use 3–30 ASCII letters, digits, dot, hyphen, or underscore.", 400],
    [{ username: "new.validation", password: "short", confirmPassword: "short" }, "Password must contain 12–128 characters.", 400],
    [{ username: "new.validation", password, confirmPassword: "a different passphrase" }, "Passwords do not match.", 400],
  ] as const) {
    expect(await usersAction(routeArgs(post({ ...fields, csrfToken })))).toMatchObject({ data: { error, username: fields.username }, init: { status } });
  }
  for (const intent of ["disable-member", "reactivate-member", "delete-member"]) {
    const field = intent === "delete-member" ? "deletionError" : "accessError";
    for (const targetUsername of ["not a username", "Regular.Member", ""]) {
      expect(await usersAction(routeArgs(post({ csrfToken, intent, targetUsername })))).toMatchObject({ data: { [field]: unavailable }, init: { status: 409 } });
    }
  }
  for (const targetUserId of ["0", "-1", "1.5", "9007199254740992", "invalid"]) {
    expect(await usersAction(routeArgs(post({ csrfToken, intent: "delete-member", targetUserId, targetUsername: "regular.member" })))).toMatchObject({ data: { deletionError: unavailable }, init: { status: 409 } });
  }
  for (const fields of [
    { targetUsername: "not a username", newPassword: password, confirmPassword: password },
    { targetUsername: "Regular.Member", newPassword: "short", confirmPassword: "short" },
    { targetUsername: "Regular.Member", newPassword: password, confirmPassword: password },
    { targetUsername: "missing.reset", newPassword: password, confirmPassword: password },
  ]) {
    expect(await usersAction(routeArgs(post({ ...fields, csrfToken, intent: "reset-member-password" })))).toMatchObject({ data: { passwordResetError: unavailable }, init: { status: 409 } });
  }
  expect(await usersAction(routeArgs(post({ csrfToken, intent: "reset-member-password", targetUsername: "regular.member", newPassword: "short", confirmPassword: "short" })))).toMatchObject({ data: { passwordResetError: "Password must contain 12–128 characters." }, init: { status: 400 } });
  const member = before.find((member) => member.username === "regular.member")!;
  expect(await usersAction(routeArgs(post({ csrfToken, intent: "delete-member", targetUserId: String(member.id), targetUsername: member.username, confirmationUsername: "wrong.member" })))).toMatchObject({ data: { deletionError: "Enter regular.member exactly to confirm permanent deletion." }, init: { status: 400 } });
  expect(await usersAction(routeArgs(post({ csrfToken, intent: "delete-member", targetUserId: "999999", targetUsername: "missing.member", confirmationUsername: "missing.member" })))).toMatchObject({ data: { deletionError: unavailable }, init: { status: 409 } });
  expect(await usersAction(routeArgs(post({ csrfToken, intent: "disable-member", targetUsername: "missing.member", confirmationUsername: "missing.member" })))).toMatchObject({ data: { accessError: "Member access has changed. Refresh and try again." }, init: { status: 409 } });
  expect(authentication.listManageableMembers()).toEqual(before);
});
