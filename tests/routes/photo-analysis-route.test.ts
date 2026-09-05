import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
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
import { action, loader } from "../../app/routes/photo-analysis";
import { seedAuthenticatedAccount } from "../support/authentication";

const origin = "http://localhost:3000";
let directory: string;
let cookie: string;
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
  cookie = serializeSessionCookie(account).split(";")[0];
  otherCookie = serializeSessionCookie(other).split(";")[0];
  csrf = account.csrfToken;
  db.insert(userPreferences)
    .values({
      userId: account.user.id,
      timeZone: "America/New_York",
      displayUnits: "metric",
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
