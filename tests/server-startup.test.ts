import { describe, expect, test } from "vitest";

import { validateServerConfiguration } from "../server/startup-configuration.js";

describe("server startup configuration", () => {
  const productionEnvironment = {
    APPLICATION_URL: "https://calories.example.test",
    NODE_ENV: "production",
    PORT: "4173",
    TRUST_PROXY: "172.30.0.0/16",
  };

  test("accepts production without a proxy CIDR", () => {
    expect(validateServerConfiguration(productionEnvironment)).toEqual({
      port: 4173,
    });
  });

  test.each([
    [undefined, 3000],
    ["1", 1],
    ["65535", 65_535],
  ])("accepts development port %s", (PORT, port) => {
    expect(validateServerConfiguration({ NODE_ENV: "development", PORT })).toEqual(
      { port },
    );
  });

  test.each(["0", "65536", "not-a-port"])(
    "rejects invalid port %s",
    (PORT) => {
      expect(() =>
        validateServerConfiguration({ ...productionEnvironment, PORT }),
      ).toThrow("PORT must be an integer from 1 through 65535");
    },
  );

  test.each([undefined, "", "invalid", "0.0.0.0/0", "172.22.0.0/16"])(
    "ignores obsolete TRUST_PROXY %s", (TRUST_PROXY) => {
      expect(validateServerConfiguration({ ...productionEnvironment, TRUST_PROXY })).toEqual({ port: 4173 });
    },
  );

  test("development does not require deployment URL or proxy settings", () => {
    expect(
      validateServerConfiguration({ NODE_ENV: "development", PORT: "3001" }),
    ).toEqual({ port: 3001 });
  });

  test.each([
    undefined,
    "",
  ])("requires an application URL outside development", (APPLICATION_URL) => {
    expect(() =>
      validateServerConfiguration({
        ...productionEnvironment,
        APPLICATION_URL,
        NODE_ENV: "test",
      }),
    ).toThrow("APPLICATION_URL is required outside development");
  });

  test.each([
    "https://user@calories.example.test",
    "https://user:password@calories.example.test",
    "https://calories.example.test/a-path",
    "https://calories.example.test?query=value",
    "https://calories.example.test#fragment",
  ])("rejects non-origin application URL %s", (APPLICATION_URL) => {
    expect(() =>
      validateServerConfiguration({
        ...productionEnvironment,
        APPLICATION_URL,
        NODE_ENV: "test",
      }),
    ).toThrow(
      "APPLICATION_URL must be an origin without credentials, path, query, or hash",
    );
  });

  test("permits HTTP application URLs outside production", () => {
    expect(
      validateServerConfiguration({
        APPLICATION_URL: "http://localhost:4173",
        NODE_ENV: "test",
        PORT: "4173",
      }),
    ).toEqual({ port: 4173 });
  });

  test("requires HTTPS application URLs in production", () => {
    expect(() =>
      validateServerConfiguration({
        ...productionEnvironment,
        APPLICATION_URL: "http://calories.example.test",
      }),
    ).toThrow("APPLICATION_URL must use HTTPS in production");
  });
});

 test("LAN_URL enables a distinct listener", () => {
   expect(validateServerConfiguration({ APPLICATION_URL: "https://calories.example.test", NODE_ENV: "production", LAN_URL: "http://192.168.4.21:3002" })).toEqual({ port: 3000, lanPort: 3002, lanHost: "0.0.0.0" });
 });
 test.each(["https://192.168.4.21:3002", "http://lan.example:3002", "http://192.168.4.21", "http://127.1:3002", "http://3232236565:3002", "http://user@192.168.4.21:3002", "http://192.168.4.21:3002/a/..", "http://192.168.4.21:3002?", "http://192.168.4.21:3002#"])("rejects invalid LAN origin %s", (LAN_URL) => {
   expect(() => validateServerConfiguration({ NODE_ENV: "production", APPLICATION_URL: "https://calories.example.test", LAN_URL })).toThrow(/LAN_URL/);
 });
 test.each(["3000", "bad", "65536", "3002junk"])("rejects invalid/conflicting LAN port %s", (LAN_PORT) => {
   expect(() => validateServerConfiguration({ NODE_ENV: "production", APPLICATION_URL: "https://calories.example.test", LAN_URL: "http://192.168.4.21:3002", LAN_PORT })).toThrow(/LAN_PORT/);
 });
 test("LAN accepts an explicit IPv6 server authority", () => {
   expect(validateServerConfiguration({ NODE_ENV: "production", APPLICATION_URL: "https://calories.example.test", LAN_URL: "http://[fd00::21]:3002", LAN_PORT: "3003" })).toEqual({ port: 3000, lanPort: 3003, lanHost: "::" });
 });
