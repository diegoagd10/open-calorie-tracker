import { afterEach, describe, expect, test, vi } from "vitest";

import {
  operationalError,
  operationalLog,
} from "../server/operational-logging.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

function loggedRecord(
  method: "error" | "log",
): Record<string, unknown> {
  const spy =
    method === "error" ? vi.mocked(console.error) : vi.mocked(console.log);
  expect(spy).toHaveBeenCalledOnce();
  return JSON.parse(String(spy.mock.calls[0]?.[0])) as Record<string, unknown>;
}

describe("operational logging", () => {
  test("info records are structured on stdout", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const stderr = vi.spyOn(console, "error").mockImplementation(() => {});

    operationalLog("info", "server_started", { port: 4173 });

    expect(loggedRecord("log")).toMatchObject({
      event: "server_started",
      level: "info",
      port: 4173,
      timestamp: expect.any(String) as unknown,
    });
    expect(stderr).not.toHaveBeenCalled();
  });

  test.each(["warn", "error"] as const)("%s records are structured on stderr", (level) => {
    const stdout = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    operationalLog(level, "request_failed", { status: 503 });

    expect(loggedRecord("error")).toMatchObject({
      event: "request_failed",
      level,
      status: 503,
    });
    expect(stdout).not.toHaveBeenCalled();
  });

  test("sensitive keys are redacted recursively without changing safe values", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    operationalLog("info", "nested_details", {
      apiKey: "api-value",
      nested: {
        authorization: "bearer-value",
        ordinary: "visible",
      },
      rows: [{ cookie: "cookie-value" }, null, 7, false],
      session: "session-value",
    });

    expect(loggedRecord("log")).toMatchObject({
      apiKey: "[REDACTED]",
      nested: { authorization: "[REDACTED]", ordinary: "visible" },
      rows: [{ cookie: "[REDACTED]" }, null, 7, false],
      session: "[REDACTED]",
    });
  });

  test("key-value secrets embedded in text are fully redacted", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    operationalLog("info", "unsafe_text", {
      message:
        "apiKey=alpha123&password=bravo-456; TOKEN=charlie_789 safe=value",
    });

    expect(loggedRecord("log")).toMatchObject({
      message:
        "apiKey=[REDACTED]&password=[REDACTED]; TOKEN=[REDACTED] safe=value",
    });
  });

  test("API keys anywhere in text keep only their display prefix", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const key = `oct_abcd${"Z".repeat(35)}wxyz`;

    operationalLog("info", "unsafe_text", {
      message: `query k=${key} header Bearer ${key}`,
      keyPrefix: "oct_abcd",
    });

    expect(loggedRecord("log")).toMatchObject({
      message: "query k=oct_abcd[REDACTED] header Bearer oct_abcd[REDACTED]",
      keyPrefix: "oct_abcd",
    });
  });

  test("configured secret values are redacted longest-first wherever they occur", () => {
    vi.stubEnv("MUTATION_PASSWORD", "deployment-secret");
    vi.stubEnv("MUTATION_SECRET", "deployment-secret-with-suffix");
    vi.spyOn(console, "log").mockImplementation(() => {});

    operationalLog("info", "configured_secrets", {
      message: "deployment-secret-with-suffix and deployment-secret",
    });

    expect(loggedRecord("log")).toMatchObject({
      message: "[REDACTED] and [REDACTED]",
    });
  });

  test("configured contact details are omitted from operational logs", () => {
    vi.stubEnv("EXAMPLE_CONTACT_EMAIL", "private@example.test");
    vi.spyOn(console, "log").mockImplementation(() => {});

    operationalLog("info", "catalog_configuration", {
      contactEmail: "private@example.test",
      message: "configured for private@example.test",
    });

    expect(loggedRecord("log")).toMatchObject({
      contactEmail: "[REDACTED]",
      message: "configured for [REDACTED]",
    });

    vi.mocked(console.log).mockClear();
    operationalLog("info", "catalog_configuration", {
      "contact-email": "private@example.test",
      contact_email: "private@example.test",
      contactemail: "different@example.test",
    });
    expect(loggedRecord("log")).toMatchObject({
      "contact-email": "[REDACTED]",
      contact_email: "[REDACTED]",
      contactemail: "[REDACTED]",
    });
  });

  test("empty configured secrets do not alter ordinary log text", () => {
    vi.stubEnv("EMPTY_PASSWORD", "");
    vi.spyOn(console, "log").mockImplementation(() => {});

    operationalLog("info", "ordinary", { message: "remains visible" });

    expect(loggedRecord("log")).toMatchObject({ message: "remains visible" });
  });

  test("ordinary environment values remain visible", () => {
    vi.stubEnv("VISIBLE_SETTING", "visible-environment-value");
    vi.spyOn(console, "log").mockImplementation(() => {});

    operationalLog("info", "ordinary_environment", {
      message: "visible-environment-value",
    });

    expect(loggedRecord("log")).toMatchObject({
      message: "visible-environment-value",
    });
  });
});

describe("operational errors", () => {
  test("Error details retain their type while redacting their message", () => {
    vi.stubEnv("OWNER_PASSWORD", "deployment-secret");

    expect(
      operationalError(
        new TypeError("password=inline-secret deployment-secret"),
      ),
    ).toEqual({
      message: "password=[REDACTED] [REDACTED]",
      name: "TypeError",
    });
  });

  test("callers can omit Error messages", () => {
    expect(operationalError(new RangeError("private detail"), false)).toEqual({
      name: "RangeError",
    });
  });

  test("non-Error failures have a stable safe description", () => {
    expect(operationalError("password=unsafe")).toEqual({
      message: "Unknown operational failure",
      name: "UnknownError",
    });
    expect(operationalError({ reason: "unsafe" }, false)).toEqual({
      name: "UnknownError",
    });
  });
});
