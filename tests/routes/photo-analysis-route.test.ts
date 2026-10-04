import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { RouterContextProvider } from "react-router";
import { afterAll, beforeAll, expect, test } from "vitest";
import { serializeSessionCookie } from "../../app/auth/http.server";
import { getAuthenticationService } from "../../app/auth/runtime.server";
import {
  getApplicationDatabase,
  shutdownApplicationDatabase,
} from "../../app/database/runtime.server";
import { userPreferences } from "../../app/database/schema.server";
import { shutdownPhotoAnalysis } from "../../app/photo-analysis/runtime.server";
import {
  PHOTO_ANALYSIS_TEST_READINESS_KEY,
  photoAnalysisTestReadinessCodeSchema,
} from "../../app/photo-analysis/test-fixture.server";
import { action, loader } from "../../app/routes/photo-analysis";
import { seedAuthenticatedAccount } from "../support/authentication";

const origin = "http://localhost:3000";
let directory: string;
let cookie: string;
let adminCookie: string;
let adminCsrf: string;
let otherCookie: string;
let csrf: string;
const bytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFElEQVR4nGP4TyJgGNUwqmH4agAAr639H708R/EAAAAASUVORK5CYII=",
  "base64",
);
function args(request: Request) {
  return {
    request,
    params: {},
    context: new RouterContextProvider(),
    pattern: "/photo-analysis",
    url: new URL(request.url),
  };
}
function form(token = csrf) {
  const form = new FormData();
  form.set("csrfToken", token);
  form.set("date", "2026-08-28");
  form.set("intent", "start");
  form.set("idempotencyKey", "route-photo-request");
  form.set("photo", new File([bytes], "plate.png", { type: "image/png" }));
  return form;
}
function post(body: FormData, session = cookie, requestOrigin = origin) {
  return args(
    new Request(`${origin}/photo-analysis`, {
      method: "POST",
      body,
      headers: { Cookie: session, Origin: requestOrigin },
    }),
  );
}
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "photo-routes-"));
  process.env.DATABASE_PATH = path.join(directory, "db.sqlite");
  process.env.PHOTO_ANALYSIS_TEST_FIXTURE = "1";
  const db = getApplicationDatabase().getClient();
  const account = await seedAuthenticatedAccount(
    getAuthenticationService(),
    db,
    "photo.owner",
    "correct horse battery staple",
    "192.0.2.10",
  );
  const other = await seedAuthenticatedAccount(
    getAuthenticationService(),
    db,
    "photo.other",
    "correct horse battery staple",
    "192.0.2.11",
  );
  const admin = await seedAuthenticatedAccount(
    getAuthenticationService(),
    db,
    "photo.admin",
    "correct horse battery staple",
    "192.0.2.12",
    "admin",
  );
  cookie = serializeSessionCookie(account).split(";")[0];
  otherCookie = serializeSessionCookie(other).split(";")[0];
  csrf = account.csrfToken;
  adminCookie = serializeSessionCookie(admin).split(";")[0];
  adminCsrf = admin.csrfToken;
  db.insert(userPreferences)
    .values({
      userId: account.user.id,
      timeZone: "America/New_York",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    })
    .run();
  db.insert(userPreferences)
    .values({
      userId: admin.user.id,
      timeZone: "America/New_York",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    })
    .run();
});
afterAll(async () => {
  shutdownPhotoAnalysis();
  await Promise.resolve();
  shutdownApplicationDatabase();
  delete process.env.DATABASE_PATH;
  delete process.env.PHOTO_ANALYSIS_TEST_FIXTURE;
  await rm(directory, { recursive: true, force: true });
});

test("photo upload requires a session, origin and CSRF, and returns an owned private processing resource", async () => {
  expect((await action(post(form(), ""))).status).toBe(302);
  await expect(
    action(post(form(), cookie, "https://attacker.test")),
  ).rejects.toMatchObject({ status: 403 });
  expect((await action(post(form("invalid")))).status).toBe(403);
  const response = await action(post(form()));
  expect(response.status).toBe(202);
  const value = (await response.json()) as {
    id: string;
    status: string;
    attemptId: string;
  };
  expect(value.status).toBe("active");
  const repeated = await action(post(form()));
  expect(await repeated.json()).toMatchObject({
    id: value.id,
    attemptId: value.attemptId,
  });
  const read = (session: string, image = false) =>
    loader(
      args(
        new Request(
          `${origin}/photo-analysis?id=${value.id}${image ? "&image=1" : ""}`,
          { headers: { Cookie: session } },
        ),
      ),
    );
  expect((await read(otherCookie)).status).toBe(404);
  expect((await read(otherCookie, true)).status).toBe(404);
  const photo = await read(cookie, true);
  expect(photo.headers.get("Cache-Control")).toBe("private, no-store");
  expect(Buffer.from(await photo.arrayBuffer())).toEqual(bytes);
});

test("status, correction, cancellation, retry and deletion preserve the authenticated HTTP contract", async () => {
  const initial = form();
  initial.set("idempotencyKey", "route-full-workflow");
  const started = await action(post(initial));
  const meal = (await started.json()) as {
    id: string;
    attemptId: string;
    entryId: number;
  };
  const read = () =>
    loader(
      args(
        new Request(`${origin}/photo-analysis?id=${meal.id}`, {
          headers: { Cookie: cookie },
        }),
      ),
    );
  const submit = (intent: string, fields: Record<string, string> = {}) => {
    const body = new FormData();
    for (const [key, value] of Object.entries({
      intent,
      csrfToken: csrf,
      id: meal.id,
      ...fields,
    }))
      body.set(key, value);
    return action(post(body));
  };
  await expect
    .poll(
      async () => ((await (await read()).json()) as { status: string }).status,
      { timeout: 4000 },
    )
    .toBe("succeeded");
  const saved = await read();
  expect(saved.headers.get("Cache-Control")).toBe("private, no-store");
  const value = (await saved.json()) as { entryId: number; result: unknown };
  expect(value).toMatchObject({
    energyMilliKcal: 250000,
    provenanceState: "recorded",
    result: {
      name: "Photo rice plate",
      consumedFraction: 1,
      assumptions: ["Rice portion estimated from the photo"],
      components: [
        {
          id: "rice",
          name: "Cooked rice",
          quantity: 200,
          unit: "g",
          includes: [],
          source: {
            kind: "ai",
            reason: "No USDA category adequately matched the visible component.",
          },
          nutrition: {
            energyKcal: 250,
            proteinGrams: 5,
            carbohydrateGrams: 50,
            fatGrams: 2,
          },
        },
      ],
    },
  });
  expect(value).not.toHaveProperty("diagnostics");
  const correction = await submit("correct", {
    entryId: String(value.entryId),
    correction: "Extra butter",
    idempotencyKey: "route-full-correction",
  });
  expect(correction.status).toBe(202);
  const processing = (await correction.json()) as { attemptId: string };
  expect(processing).toMatchObject({
    id: meal.id,
    status: "active",
    energyMilliKcal: 250000,
    entryId: value.entryId,
  });
  const canceled = await submit("cancel", { attemptId: processing.attemptId });
  expect(canceled.status).toBe(200);
  expect(await canceled.json()).toMatchObject({
    status: "canceled",
    energyMilliKcal: 250000,
  });
  const retried = await submit("retry", {
    attemptId: processing.attemptId,
    idempotencyKey: "route-full-retry",
  });
  expect(retried.status).toBe(202);
  await expect
    .poll(
      async () => ((await (await read()).json()) as { status: string }).status,
      { timeout: 4000 },
    )
    .toBe("succeeded");
  expect(await (await read()).json()).toMatchObject({
    entryId: value.entryId,
    energyMilliKcal: 350000,
  });
  await submit("correct", {
    entryId: String(value.entryId),
    correction: "fail this analysis",
    idempotencyKey: "route-full-failure",
  });
  await expect
    .poll(
      async () => ((await (await read()).json()) as { status: string }).status,
      { timeout: 4000 },
    )
    .toBe("failed");
  expect(await (await read()).json()).toMatchObject({
    energyMilliKcal: 350000,
    error: "Analysis failed. Retry or use another food-entry method.",
  });
  const deleted = await submit("delete");
  expect(deleted.status).toBe(200);
  expect(deleted.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await deleted.json()).toEqual({ deleted: true });
  expect(await (await read()).json()).toEqual({
    error: "Photo meal unavailable",
  });
}, 15000);

test("invalid uploads and operations return actionable private errors", async () => {
  const noSession = await loader(args(new Request(`${origin}/photo-analysis`)));
  expect(noSession.headers.get("Location")).toBe("/login");
  expect((await loader(args(new Request(`${origin}/photo-analysis`, {
    headers: { Cookie: cookie },
  })))).status).toBe(404);
  expect((await action(post(form(), ""))).headers.get("Location")).toBe(
    "/login",
  );
  const rejected = await action(post(form("bad")));
  expect(await rejected.json()).toEqual({ error: "CSRF token rejected" });
  const missingCsrf = form();
  missingCsrf.delete("csrfToken");
  expect((await action(post(missingCsrf))).status).toBe(403);
  for (const [changes, expected] of [
    [{ intent: "nonsense" }, "Unknown photo action"],
    [{ photo: "not a file" }, "Choose a plate photo"],
    [
      { intent: "correct", entryId: "wrong" },
      "Check the photo request and try again",
    ],
  ] as const) {
    const body = form();
    for (const [key, value] of Object.entries(changes)) body.set(key, value);
    const response = await action(post(body));
    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await response.json()).toEqual({ error: expected });
  }
  for (const body of [
    (() => {
      const value = form();
      value.delete("date");
      value.set("idempotencyKey", "missing-date");
      return value;
    })(),
    (() => {
      const value = form();
      value.set("intent", "correct");
      value.set("entryId", "1");
      value.delete("correction");
      value.set("idempotencyKey", "missing-correction");
      return value;
    })(),
    (() => {
      const value = form();
      value.set("intent", "retry");
      value.set("id", "missing");
      value.delete("attemptId");
      value.set("idempotencyKey", "missing-retry-attempt");
      return value;
    })(),
    (() => {
      const value = form();
      value.set("intent", "cancel");
      value.set("id", "missing");
      value.delete("attemptId");
      return value;
    })(),
  ]) {
    expect((await action(post(body))).status).toBe(400);
  }
  const empty = await action(
    args(
      new Request(`${origin}/photo-analysis`, {
        method: "POST",
        headers: { Origin: origin, Cookie: cookie },
      }),
    ),
  );
  expect(await empty.json()).toEqual({ error: "Upload is empty" });
  const huge = new Request(`${origin}/photo-analysis`, {
    method: "POST",
    body: new Uint8Array(9 * 1024 * 1024 + 1),
    headers: {
      Origin: origin,
      Cookie: cookie,
      "Content-Type": "application/octet-stream",
    },
  });
  expect(await (await action(args(huge))).json()).toEqual({
    error: "Choose a photo up to 8 MB",
  });
});

test.each(photoAnalysisTestReadinessCodeSchema.options)("stale clients cannot start when readiness is %s", async (code) => {
  const db = getApplicationDatabase().getClient();
  const before = db.get<{ count: number }>(sql`SELECT count(*) AS count FROM photo_attempts`).count;
  db.run(sql`
    INSERT INTO application_metadata (key, value, updated_at)
    VALUES (${PHOTO_ANALYSIS_TEST_READINESS_KEY}, ${code}, '2026-09-20T00:00:00.000Z')
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `);
  try {
    const body = form();
    body.set("idempotencyKey", `blocked:${code}`);
    const response = await action(post(body));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "AI photo analysis is not available right now.",
    });
    expect(db.get<{ count: number }>(sql`SELECT count(*) AS count FROM photo_attempts`).count).toBe(before);
  } finally {
    db.run(sql`DELETE FROM application_metadata WHERE key = ${PHOTO_ANALYSIS_TEST_READINESS_KEY}`);
  }
});

test("stale correction and retry requests are rejected before a new attempt is stored", async () => {
  const started = form();
  started.set("idempotencyKey", "readiness-stale-lifecycle");
  const initial = (await (await action(post(started))).json()) as {
    id: string;
    attemptId: string;
    entryId: number | null;
  };
  const read = async () =>
    (await (await loader(args(new Request(`${origin}/photo-analysis?id=${initial.id}`, {
      headers: { Cookie: cookie },
    })))).json()) as { attemptId: string; entryId: number; status: string };
  await expect.poll(async () => (await read()).status, { timeout: 4_000 }).toBe("succeeded");
  const succeeded = await read();
  const db = getApplicationDatabase().getClient();
  db.run(sql`
    INSERT INTO application_metadata (key, value, updated_at)
    VALUES (${PHOTO_ANALYSIS_TEST_READINESS_KEY}, 'unavailable-models', '2026-09-20T00:00:00.000Z')
  `);
  const before = db.get<{ count: number }>(sql`SELECT count(*) AS count FROM photo_attempts`).count;
  try {
    const correction = new FormData();
    correction.set("csrfToken", csrf);
    correction.set("intent", "correct");
    correction.set("entryId", String(succeeded.entryId));
    correction.set("correction", "Add butter");
    correction.set("idempotencyKey", "blocked-correction");
    expect((await action(post(correction))).status).toBe(503);

    db.run(sql`UPDATE photo_attempts SET status = 'failed', finished_at = '2026-09-20T00:00:00.000Z' WHERE id = ${succeeded.attemptId}`);
    const retry = new FormData();
    retry.set("csrfToken", csrf);
    retry.set("intent", "retry");
    retry.set("id", initial.id);
    retry.set("attemptId", succeeded.attemptId);
    retry.set("idempotencyKey", "blocked-retry");
    expect((await action(post(retry))).status).toBe(503);
    expect(db.get<{ count: number }>(sql`SELECT count(*) AS count FROM photo_attempts`).count).toBe(before);
  } finally {
    db.run(sql`DELETE FROM application_metadata WHERE key = ${PHOTO_ANALYSIS_TEST_READINESS_KEY}`);
  }
});

test("blocked administrator requests include the relevant recovery destination", async () => {
  const db = getApplicationDatabase().getClient();
  db.run(sql`
    INSERT INTO application_metadata (key, value, updated_at)
    VALUES (${PHOTO_ANALYSIS_TEST_READINESS_KEY}, 'catalog-reimport-required', '2026-09-20T00:00:00.000Z')
  `);
  try {
    const body = form(adminCsrf);
    body.set("idempotencyKey", "blocked-admin-request");
    const response = await action(post(body, adminCookie));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Reimport USDA Foundation for Photo Analysis.",
      destination: "/settings/catalogs",
    });
  } finally {
    db.run(sql`DELETE FROM application_metadata WHERE key = ${PHOTO_ANALYSIS_TEST_READINESS_KEY}`);
  }
});
