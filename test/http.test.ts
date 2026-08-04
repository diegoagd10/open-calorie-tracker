import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createApplication } from "../src/app.js";
import { applyMigrations } from "../src/db/migrations.js";
import { closeDatabase, openDatabase, type DatabaseConnection } from "../src/db/client.js";
import type { AiFoodAdapter, BarcodeAdapter, FoodSearchAdapter, LabelCandidateAdapter } from "../src/adapters/types.js";
import { ProviderFailure } from "../src/adapters/errors.js";

const connections: DatabaseConnection[] = [];
const directories: string[] = [];
const servers: Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  for (const connection of connections.splice(0)) closeDatabase(connection);
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

async function testServer(barcodeAdapter?: BarcodeAdapter, labelAdapter?: LabelCandidateAdapter, aiAdapter?: AiFoodAdapter, searchAdapter?: FoodSearchAdapter): Promise<{ baseUrl: string; application: ReturnType<typeof createApplication> }> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "calories-http-"));
  directories.push(directory);
  const connection = openDatabase(directory);
  connections.push(connection);
  applyMigrations(connection.sqlite);
  const application = createApplication({ connection, dataDir: directory, config: { dataDir: directory, timezone: "America/New_York" }, barcodeAdapter, labelAdapter, aiAdapter, searchAdapter, migrate: false });
  const server = application.app.listen(0);
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  return { baseUrl: `http://127.0.0.1:${address.port}`, application };
}

test("daily log and manual Food route form an explicit confirmation journey", async () => {
  const { baseUrl, application } = await testServer();
  let response = await fetch(`${baseUrl}/log`);
  let html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Daily log/);
  assert.match(html, /Food Database/);
  assert.match(html, /Scan Food/);
  assert.match(html, /Saved Foods/);
  assert.match(html, /nothing is saved until you confirm/i);

  response = await fetch(`${baseUrl}/foods`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ name: "Toast", quantityBasis: "slice", basisQuantity: "1", calories: "100", protein: "4" }), redirect: "manual" });
  assert.equal(response.status, 303);
  const food = application.store.listFoods()[0];
  assert.equal(food.nutrients.fiber, null);

  response = await fetch(`${baseUrl}/review?foodId=${food.id}`);
  html = await response.text();
  assert.match(html, /Add to Log/);
  assert.match(html, /Save to Saved Foods/);

  response = await fetch(`${baseUrl}/review/food/${food.id}/add`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ quantity: "1/2", date: "2026-01-01", time: "19:30" }), redirect: "manual" });
  assert.equal(response.status, 303);
  assert.equal(application.store.listFoodEntriesByDate("2026-01-01", "America/New_York").length, 1);
});

test("browser timezone seeding is offered only for the bootstrap User and updates the local setting", async () => {
  const { baseUrl, application } = await testServer();
  let response = await fetch(`${baseUrl}/log`);
  let html = await response.text();
  assert.match(html, /timezone-seed\.js/);
  response = await fetch(`${baseUrl}/settings/timezone/seed`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ timezone: "America/Los_Angeles" }) });
  assert.equal(response.status, 204);
  assert.equal(application.store.getTimezone(), "America/Los_Angeles");
  html = await (await fetch(`${baseUrl}/log`)).text();
  assert.doesNotMatch(html, /timezone-seed\.js/);
});

test("shared review exposes descriptions and client-side quantity recalculation data", async () => {
  const { baseUrl } = await testServer();
  await fetch(`${baseUrl}/foods`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ name: "Soup", quantityBasis: "g", basisQuantity: "100", calories: "300", description: "A warm lunch" }) });
  const html = await (await fetch(`${baseUrl}/review?foodId=1`)).text();
  assert.match(html, /A warm lunch/);
  assert.match(html, /data-review-quantity/);
  assert.match(html, /data-review-value="calories"/);
  assert.match(html, /data-base-value="3"/);
});

test("barcode results remain transient candidates until Add to Log", async () => {
  const adapter: BarcodeAdapter = { lookup: async () => ({ name: "Candidate oats", brand: null, description: null, quantityBasis: "serving", basisQuantity: 1, nutrients: { calories: 200, protein: 8 }, source: "fake provider", warnings: [], complete: true, requiresReview: true }) };
  const { baseUrl, application } = await testServer(adapter);
  let response = await fetch(`${baseUrl}/scan/barcode`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ barcode: "12345678" }) });
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Candidate oats/);
  assert.equal(application.store.listFoods().length, 0);
  assert.equal(application.store.listFoodEntriesByDate("2026-01-01", "America/New_York").length, 0);
  const token = html.match(/action="\/review\/candidate\/([^/]+)\/add"/)?.[1];
  assert.ok(token);
  assert.match(html, new RegExp(`formaction="/review/candidate/${token}/save"`));
  response = await fetch(`${baseUrl}/review/candidate/${token}/save`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ name: "Edited oats", quantityBasis: "serving", calories: "250" }), redirect: "manual" });
  assert.equal(response.status, 303);
  assert.equal(application.store.listFoods()[0]?.name, "Edited oats");
});

test("candidate confirmation requires an explicit declared basis", async () => {
  const adapter: BarcodeAdapter = { lookup: async () => ({ name: "Unbased candidate", brand: null, description: null, quantityBasis: "", basisQuantity: 1, nutrients: { calories: 200 }, source: "fake provider", warnings: [], complete: false, requiresReview: true }) };
  const { baseUrl, application } = await testServer(adapter);
  const review = await fetch(`${baseUrl}/scan/barcode`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ barcode: "12345678" }) });
  const html = await review.text();
  const token = html.match(/action="\/review\/candidate\/([^/]+)\/add"/)?.[1];
  assert.ok(token);
  const response = await fetch(`${baseUrl}/review/candidate/${token}/add`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ quantity: "1", date: "2026-01-01", time: "12:00" }) });
  assert.equal(response.status, 400);
  assert.equal(application.store.listFoodEntriesByDate("2026-01-01", "America/New_York").length, 0);
});

test("editing only quantity and date keeps the reusable Food source linked", async () => {
  const { baseUrl, application } = await testServer();
  const food = application.store.createFood({ name: "Linked toast", quantityBasis: "slice", nutrients: { calories: 100, protein: 4 } });
  const entry = application.store.addFoodEntry({ foodId: food.id, quantity: 1, loggedAtUtc: "2026-01-01T17:00:00.000Z" });
  const response = await fetch(`${baseUrl}/entries/${entry.id}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ date: "2026-01-02", time: "13:00", quantity: "2", mealTag: "Lunch", name: food.name, quantityBasis: food.quantityBasis, basisQuantity: String(food.basisQuantity), calories: "100", protein: "4" }), redirect: "manual" });
  assert.equal(response.status, 303);
  assert.equal(application.store.getFoodEntry(entry.id)?.foodId, food.id);
  assert.equal(application.store.getFoodEntry(entry.id)?.snapshot.nutrients.calories, 200);
});

test("retryable barcode failures preserve the submitted barcode in the retry form", async () => {
  const adapter: BarcodeAdapter = { lookup: async () => { throw new ProviderFailure("temporarily_unavailable", "Provider unavailable."); } };
  const { baseUrl } = await testServer(adapter);
  const html = await (await fetch(`${baseUrl}/scan/barcode`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ barcode: "12345678" }) })).text();
  assert.match(html, /action="\/scan\/barcode"/);
  assert.match(html, /name="barcode" value="12345678"/);
});

test("retryable image failures return to the upload form without posting a lost file", async () => {
  const labelAdapter: LabelCandidateAdapter = { extract: async () => { throw new ProviderFailure("temporarily_unavailable", "Provider unavailable."); } };
  const { baseUrl } = await testServer(undefined, labelAdapter);
  const form = new FormData();
  form.append("image", new Blob(["image"], { type: "image/png" }), "label.png");
  const html = await (await fetch(`${baseUrl}/scan/label`, { method: "POST", body: form })).text();
  assert.match(html, /<form method="get" action="\/scan">/);
});

test("health checks the local database and does not depend on providers", async () => {
  const { baseUrl } = await testServer();
  const response = await fetch(`${baseUrl}/health`);
  assert.deepEqual(await response.json(), { status: "ok", database: "ok" });
});

test("scan mode pages render their dedicated capture forms", async () => {
  const { baseUrl } = await testServer();
  let html = await (await fetch(`${baseUrl}/scan?mode=barcode`)).text();
  assert.match(html, /<form[^>]*method="post" action="\/scan\/barcode"/);
  assert.match(html, /name="barcode"/);
  assert.match(html, /data-barcode-video/);
  assert.match(html, /data-barcode-scan/);
  assert.doesNotMatch(html, /data-barcode-start|Use camera image/);
  assert.match(html, /@zxing\/browser@0\.1\.5/);
  const reviewScript = await (await fetch(`${baseUrl}/review.js`)).text();
  assert.match(reviewScript, /getUserMedia/);
  assert.match(reviewScript, /BrowserMultiFormatReader/);
  assert.match(reviewScript, /decodeFromVideoElement/);
  assert.doesNotMatch(html, /action="\/scan\/food" enctype/);

  html = await (await fetch(`${baseUrl}/scan?mode=label`)).text();
  assert.match(html, /<form method="post" action="\/scan\/label"/);
  assert.match(html, /name="image"/);
  assert.match(html, /data-label-video/);
  assert.match(html, /data-label-capture/);
  assert.doesNotMatch(html, /data-label-start|Use camera image/);
  assert.doesNotMatch(html, /action="\/scan\/food" enctype/);
});

test("partial Food Label extraction stays editable until required calories are supplied", async () => {
  const labelAdapter: LabelCandidateAdapter = { extract: async () => ({ name: "Partial label", brand: null, description: null, quantityBasis: "serving", basisQuantity: 1, nutrients: { calories: null, protein: null, sodium: 180 }, source: "Food Label", warnings: ["Calories are missing"], complete: false, requiresReview: true }) };
  const { baseUrl } = await testServer(undefined, labelAdapter);
  const form = new FormData();
  form.append("image", new Blob(["image"], { type: "image/png" }), "label.png");
  const response = await fetch(`${baseUrl}/scan/label`, { method: "POST", body: form });
  const html = await response.text();
  assert.equal(response.status, 200);
  assert.match(html, /Partial label/);
  assert.match(html, /Edit candidate values/);
  assert.match(html, /Calories are missing/);
});

test("food image proposals require explicit confirmation before creating Foods or Meals", async () => {
  const aiAdapter: AiFoodAdapter = {
    analyze: async () => ({ isFood: true, ingredients: [{ name: "Rice", quantity: "1/2", unit: "cup", confidence: "high" }], warnings: [] }),
    proposeEdit: async ({ ingredients }) => ({ message: "Proposal", ingredients }),
  };
  const searchAdapter: FoodSearchAdapter = { search: async () => [{ name: "Rice", brand: null, description: null, quantityBasis: "cup", basisQuantity: 1, nutrients: { calories: 100, protein: 2 }, source: "fake", warnings: [], complete: true, requiresReview: true }] };
  const { baseUrl, application } = await testServer(undefined, undefined, aiAdapter, searchAdapter);
  const form = new FormData();
  form.append("image", new Blob(["image"], { type: "image/png" }), "food.png");
  const response = await fetch(`${baseUrl}/scan/food`, { method: "POST", body: form });
  const html = await response.text();
  assert.match(html, /Review identified ingredients/);
  assert.equal(application.store.listFoods().length, 0);
  const token = html.match(/\/scan\/food\/([^/]+)\/confirm/)?.[1];
  assert.ok(token);
  const confirmation = await fetch(`${baseUrl}/scan/food/${token}/confirm`, { method: "POST", redirect: "manual" });
  assert.equal(confirmation.status, 303);
  assert.equal(application.store.listFoods().length, 1);
  assert.equal(application.store.listMeals().length, 1);
});
