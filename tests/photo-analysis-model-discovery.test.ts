import { expect, test, vi } from "vitest";

import {
  ModelDiscoveryError,
  RemotePhotoAnalysisModelDiscovery,
} from "../app/photo-analysis/model-discovery.server";

test("discovers Gemini pages and concrete Jev versions through authenticated server requests", async () => {
  const network = vi.fn<typeof fetch>(async input => {
    const url = String(input);
    if (url.includes("generativelanguage") && url.includes("pageToken=next")) {
      return Response.json({
        models: [{ name: "models/gemini-3.5-flash", displayName: "Gemini 3.5 Flash", supportedGenerationMethods: ["generateContent"] }],
      });
    }
    if (url.includes("generativelanguage")) {
      return Response.json({
        models: [{ name: "models/gemini-3.1-flash-lite", displayName: "Gemini 3.1 Flash-Lite", supportedGenerationMethods: ["generateContent"] }],
        nextPageToken: "next",
      });
    }
    return Response.json({ data: [
      { id: "jev", effective_model: "jev-1.13.0" },
      { id: "jev-1.14.0" },
      { id: "unrelated-provider-model" },
    ] });
  });
  const discovery = new RemotePhotoAnalysisModelDiscovery(network);
  const signal = new AbortController().signal;

  await expect(discovery.discoverGemini("gemini-secret", signal)).resolves.toEqual([
    { id: "gemini-3.1-flash-lite", displayName: "Gemini 3.1 Flash-Lite", methods: ["generateContent"] },
    { id: "gemini-3.5-flash", displayName: "Gemini 3.5 Flash", methods: ["generateContent"] },
  ]);
  await expect(discovery.discoverJev("typesafe-secret", signal)).resolves.toEqual([
    { id: "jev", effectiveId: "jev-1.13.0" },
    { id: "jev-1.14.0", effectiveId: "jev-1.14.0" },
    { id: "unrelated-provider-model", effectiveId: "unrelated-provider-model" },
  ]);

  expect(network).toHaveBeenCalledTimes(3);
  for (const [url, init] of network.mock.calls) {
    expect(init?.signal).toBe(signal);
    expect(String(url)).not.toContain("secret");
  }
  expect(new Headers(network.mock.calls[0][1]?.headers).get("x-goog-api-key")).toBe("gemini-secret");
  expect(new Headers(network.mock.calls[2][1]?.headers).get("authorization")).toBe("Bearer typesafe-secret");
});

test.each([
  [401, "permanent-incompatibility"],
  [403, "permanent-incompatibility"],
  [404, "permanent-incompatibility"],
  [429, "transient-availability"],
  [500, "transient-availability"],
] as const)("maps provider status %s to a non-secret %s discovery error", async (status, kind) => {
  const key = "provider-secret-that-must-not-leak";
  const discovery = new RemotePhotoAnalysisModelDiscovery(
    vi.fn(async () => new Response(`upstream detail ${key}`, { status })),
  );

  const failure = await discovery.discoverJev(key, new AbortController().signal).catch((error: unknown) => error);
  expect(failure).toEqual(new ModelDiscoveryError(kind));
  expect(JSON.stringify(failure)).not.toContain(key);
});

test("maps malformed data and network failures without exposing provider details", async () => {
  const malformed = new RemotePhotoAnalysisModelDiscovery(vi.fn(async () => Response.json({ data: [{ unknown: "model" }] })));
  await expect(malformed.discoverJev("secret", new AbortController().signal))
    .rejects.toEqual(new ModelDiscoveryError("permanent-incompatibility"));

  const unavailable = new RemotePhotoAnalysisModelDiscovery(vi.fn(async () => { throw new Error("private socket detail"); }));
  await expect(unavailable.discoverGemini("secret", new AbortController().signal))
    .rejects.toEqual(new ModelDiscoveryError("transient-availability"));
});

test("accepts the alternate Jev models envelope and effectiveModel spelling", async () => {
  const discovery = new RemotePhotoAnalysisModelDiscovery(
    vi.fn(async () => Response.json({ models: [{ id: "jev-current", effectiveModel: "jev-1.15.0" }] })),
  );
  await expect(discovery.discoverJev("secret", new AbortController().signal)).resolves.toEqual([
    { id: "jev-current", effectiveId: "jev-1.15.0" },
  ]);
});

test("accepts current TypeSafe model metadata and resolves documented aliases to a concrete version", async () => {
  const discovery = new RemotePhotoAnalysisModelDiscovery(
    vi.fn(async () => Response.json({
      models: [
        {
          name: "jev-latest",
          description: "The latest stable Jev release",
          release_date: "2026-09-10T18:38:01.391457+00:00",
        },
        {
          name: "jev-preview",
          description: "The latest Jev release, including previews",
          release_date: "2026-09-10T18:39:06.057655+00:00",
        },
      ],
    })),
  );

  await expect(discovery.discoverJev("secret", new AbortController().signal)).resolves.toEqual([
    { id: "jev-latest", effectiveId: "jev-1.13.0" },
    { id: "jev-preview", effectiveId: "jev-1.13.0" },
  ]);
});

test.each([
  ["missing body", () => new Response(null)],
  ["invalid content length", () => new Response("{}", { headers: { "content-length": "invalid" } })],
  ["oversized declared length", () => new Response("{}", { headers: { "content-length": "500001" } })],
  ["oversized body", () => new Response("x".repeat(500_001))],
] as const)("rejects a %s without exposing response details", async (_case, response) => {
  const discovery = new RemotePhotoAnalysisModelDiscovery(vi.fn(async () => response()));
  await expect(discovery.discoverJev("secret", new AbortController().signal))
    .rejects.toEqual(new ModelDiscoveryError("permanent-incompatibility"));
});

test("preserves caller cancellation and bounds Gemini pagination", async () => {
  const controller = new AbortController();
  const reason = new Error("caller canceled");
  const canceled = new RemotePhotoAnalysisModelDiscovery(vi.fn(async () => {
    controller.abort(reason);
    throw new Error("network failure");
  }));
  await expect(canceled.discoverGemini("secret", controller.signal)).rejects.toBe(reason);

  const paginated = new RemotePhotoAnalysisModelDiscovery(vi.fn(async () => Response.json({
    models: [], nextPageToken: "never-ending",
  })));
  await expect(paginated.discoverGemini("secret", new AbortController().signal))
    .rejects.toEqual(new ModelDiscoveryError("permanent-incompatibility"));
});
