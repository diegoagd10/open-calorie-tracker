import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

describe("/api/entries", () => {
  const databasePath = join(tmpdir(), `calories-api-${process.pid}.db`);
  let GET: typeof import("./route").GET;
  let POST: typeof import("./route").POST;

  beforeAll(async () => {
    process.env.CALORIE_DB_PATH = databasePath;
    vi.resetModules();
    ({ GET, POST } = await import("./route"));
  });

  afterAll(() => {
    rmSync(databasePath, { force: true });
    delete process.env.CALORIE_DB_PATH;
  });

  it("creates an entry and returns the selected day's summary", async () => {
    const createResponse = await POST(
      new Request("http://localhost/api/entries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Greek yogurt",
          calories: 140,
          date: "2026-08-04",
        }),
      }),
    );

    expect(createResponse.status).toBe(201);
    await expect(createResponse.json()).resolves.toMatchObject({
      name: "Greek yogurt",
      calories: 140,
      date: "2026-08-04",
    });

    const listResponse = await GET(
      new Request("http://localhost/api/entries?date=2026-08-04"),
    );

    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({
      total: 140,
      entries: [{ name: "Greek yogurt", calories: 140 }],
    });
  });

  it("returns actionable validation errors", async () => {
    const response = await POST(
      new Request("http://localhost/api/entries", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "", calories: 0, date: "2026-08-04" }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Food name is required",
    });
  });
});
