import { expect, test } from "vitest";

import { resolveClientIp } from "../server/client-ip";

test("client IP resolution honors test, proxy, socket, and fallback precedence", () => {
  expect(
    resolveClientIp({
      nodeEnvironment: "test",
      proxyClientIp: "172.30.0.4",
      remoteAddress: "172.30.0.3",
      testClientIp: "203.0.113.10",
    }),
  ).toBe("203.0.113.10");
  expect(
    resolveClientIp({
      nodeEnvironment: "production",
      proxyClientIp: "172.30.0.4",
      remoteAddress: "172.30.0.3",
      testClientIp: "203.0.113.10",
    }),
  ).toBe("172.30.0.4");
  expect(
    resolveClientIp({
      nodeEnvironment: "production",
      remoteAddress: "172.30.0.3",
    }),
  ).toBe("172.30.0.3");
  expect(resolveClientIp({ nodeEnvironment: "production" })).toBe("unknown");
});
