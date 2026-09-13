import { createReadableStreamFromReadable, writeReadableStreamToWritable } from "@react-router/node";
import { createRequestHandler, type ServerBuild } from "react-router";
import type { Request as ExpressRequest, Response as ExpressResponse, RequestHandler } from "express";

import { effectiveRequestPolicy } from "../app/runtime.server";

// The Express adapter has no effective-URL override and splits IPv6 authorities
// on ':'. Use the framework's handler with the listener-owned origin instead.
export function routerHandler(build: () => Promise<ServerBuild>): RequestHandler {
  const handleRequest = createRequestHandler(build);
  return async (request, response, next) => {
    const controller = new AbortController();
    response.on("close", () => {
      if (!response.writableEnded) controller.abort();
    });
    try {
      const result = await handleRequest(frameworkRequest(request, controller.signal));
      if (response.destroyed || response.writableEnded) {
        await result.body?.cancel();
        return;
      }
      await sendFrameworkResponse(response, result);
    } catch (error) {
      if (!response.destroyed && !response.writableEnded) next(error);
    }
  };
}

function frameworkRequest(request: ExpressRequest, signal: AbortSignal): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (Array.isArray(value)) value.forEach((item) => headers.append(name, item));
    else if (value !== undefined) headers.set(name, value);
  }
  const init: RequestInit & { duplex?: "half" } = { headers, method: request.method, signal };
  if (!["GET", "HEAD"].includes(request.method)) {
    init.body = createReadableStreamFromReadable(request);
    init.duplex = "half";
  }
  return new Request(`${effectiveRequestPolicy().origin}${request.originalUrl}`, init);
}

async function sendFrameworkResponse(response: ExpressResponse, result: Response): Promise<void> {
  response.status(result.status);
  for (const [name, value] of result.headers) {
    if (name !== "set-cookie") response.setHeader(name, value);
  }
  const cookies = result.headers.getSetCookie();
  if (cookies.length) response.setHeader("Set-Cookie", cookies);
  if (result.headers.get("Content-Type")?.includes("text/event-stream")) response.flushHeaders();
  if (result.body) await writeReadableStreamToWritable(result.body, response);
  else response.end();
}
