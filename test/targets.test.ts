import test, { afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { estimateNutrition, estimateMaintenanceCalories } from "../src/domain/nutrition.js";
import { createApplication } from "../src/app.js";
import { applyMigrations } from "../src/db/migrations.js";
import { closeDatabase, openDatabase, type DatabaseConnection } from "../src/db/client.js";

const connections: DatabaseConnection[] = [];
const directories: string[] = [];
const servers: import("node:http").Server[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  for (const connection of connections.splice(0)) closeDatabase(connection);
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

test("estimate supports only the explicit adult profile and uses separate reference meanings", () => {
  assert.throws(() => estimateMaintenanceCalories({ age: 18, sex: "female", heightCm: 165, weightKg: 65, activity: "Inactive" }), /19 and older/);
  const estimate = estimateNutrition({ age: 30, sex: "female", heightCm: 165, weightKg: 65, activity: "Inactive", plan: "Maintain", today: "2026-01-01" });
  assert.equal(estimate.plan, "Maintain");
  assert.equal(estimate.references.protein?.type, "range");
  assert.equal(estimate.references.fiber?.type, "minimum");
  assert.equal(estimate.references.sodium?.type, "upper");
  assert.equal(estimate.references.sugar?.type, "label");
  assert.equal(estimate.metadata.referenceProfileVersion, "adult-general-v1");
});

test("Lose and Gain plans reject trajectories that contradict the selected intention", () => {
  assert.throws(() => estimateNutrition({ age: 30, sex: "female", heightCm: 165, weightKg: 65, activity: "Inactive", plan: "Lose", targetWeightKg: 70, targetDate: "2026-07-01", today: "2026-01-01" }), /Lose plan target weight/);
  assert.throws(() => estimateNutrition({ age: 30, sex: "female", heightCm: 165, weightKg: 65, activity: "Inactive", plan: "Gain", targetWeightKg: 60, targetDate: "2026-07-01", today: "2026-01-01" }), /Gain plan target weight/);
});

test("Lose and Gain proposals use a dynamic model and stay inactive until confirmed", async () => {
  const maintain = estimateNutrition({ age: 30, sex: "male", heightCm: 180, weightKg: 90, activity: "Active", plan: "Maintain", today: "2026-01-01" });
  const lose = estimateNutrition({ age: 30, sex: "male", heightCm: 180, weightKg: 90, activity: "Active", plan: "Lose", targetWeightKg: 80, targetDate: "2026-07-01", today: "2026-01-01" });
  assert.ok(lose.targetCalories < maintain.targetCalories);
  assert.equal(lose.metadata.modelVersion, "dynamic-energy-balance-v1");

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "calories-targets-"));
  directories.push(directory);
  const connection = openDatabase(directory);
  connections.push(connection);
  applyMigrations(connection.sqlite);
  const application = createApplication({ connection, dataDir: directory, config: { dataDir: directory, timezone: "UTC" }, migrate: false });
  const server = application.app.listen(0);
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not bind.");
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const response = await fetch(`${baseUrl}/targets/estimate`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ age: "30", sex: "male", heightCm: "180", weightKg: "90", activity: "Active", plan: "Maintain" }), redirect: "manual" });
  assert.equal(response.status, 303);
  assert.equal(application.store.getActiveTarget(), null);
  const proposalUrl = response.headers.get("location")!;
  const proposalPage = await fetch(`${baseUrl}${proposalUrl}`);
  assert.match(await proposalPage.text(), /Proposal \/ not active/);
  const token = new URL(proposalUrl, baseUrl).searchParams.get("proposal")!;
  const confirmation = await fetch(`${baseUrl}/targets/proposals/${token}/confirm`, { method: "POST", redirect: "manual" });
  assert.equal(confirmation.status, 303);
  assert.equal(application.store.getActiveTarget()?.kind, "estimate");
});
