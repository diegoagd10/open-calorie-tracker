import { isIP } from "node:net";
import type { Request, Response, RequestHandler } from "express";

import {
  configuredEntryOrigin,
  requestPolicyContext,
  type RequestEntry,
} from "../app/runtime.server";
import { operationalLog } from "./operational-logging.js";

const verificationMessage = "Public connection could not be verified. Required visitor IP information is missing or invalid. Please try again. If this continues, contact the server administrator.";

export function entryPolicy(entry: RequestEntry): RequestHandler {
  const origin = configuredEntryOrigin(entry);
  const authority = new URL(origin).host;
  return (request, response, next) => {
    delete request.headers["x-open-calory-client-ip"];
    const health = ["/health/live", "/health/ready"].includes(request.path) &&
      ["GET", "HEAD"].includes(request.method);
    if (!health && request.get("host") !== authority) {
      response.status(421).type("text/plain").send("Request authority rejected.");
      return;
    }
    let clientIp = request.socket.remoteAddress ?? "unknown";
    if (entry === "tunnel" && !health) {
      const visitorIp = verifiedVisitorIp(request);
      if (!visitorIp) {
        rejectPublicConnection(request, response);
        return;
      }
      clientIp = visitorIp;
    }
    request.headers["x-open-calory-client-ip"] = clientIp;
    requestPolicyContext.run({ entry, origin }, next);
  };
}

function verifiedVisitorIp(request: Request): string | undefined {
  const visitorIp = request.get("cf-connecting-ip");
  const count = request.rawHeaders.filter((name, index) =>
    index % 2 === 0 && name.toLowerCase() === "cf-connecting-ip",
  ).length;
  return visitorIp && count === 1 && isIP(visitorIp) ? visitorIp : undefined;
}

function rejectPublicConnection(request: Request, response: Response): void {
  operationalLog("error", "public_connection_rejected", {
    entry: "tunnel",
    reason: request.get("cf-connecting-ip") === undefined ? "missing-visitor-ip" : "invalid-visitor-ip",
    requestId: response.locals.requestId,
  });
  response.status(503).set("Cache-Control", "no-store").type("html").send(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Connection verification failed</title><style>body{margin:0;background:#f8f7f3;color:#242722;font:1rem system-ui,sans-serif}main{max-width:36rem;margin:12vh auto;padding:2rem}h1{font-size:1.6rem}p{line-height:1.6}a{color:inherit}</style></head><body><main><h1>Connection verification failed</h1><p>${verificationMessage}</p><a href="/">Try again</a></main></body></html>`,
  );
}
