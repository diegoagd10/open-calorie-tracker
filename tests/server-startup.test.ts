import { describe, expect, test } from "vitest";

import { validateServerConfiguration } from "../server/startup-configuration.js";

describe("server startup configuration", () => {
  const productionEnvironment = {
    APPLICATION_URL: "https://calories.example.test",
    NODE_ENV: "production",
    PORT: "4173",
    TRUST_PROXY: "172.30.0.0/16",
  };

  test("accepts a private production proxy and returns the listening port", () => {
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

  test.each([
    "10.0.0.0/16",
    "10.255.255.255/32",
    "172.16.0.0/16",
    "172.31.255.255/32",
    "192.168.0.0/16",
    " 192.168.255.255/32 ",
  ])("accepts private production proxy CIDR %s", (TRUST_PROXY) => {
    expect(
      validateServerConfiguration({ ...productionEnvironment, TRUST_PROXY }),
    ).toEqual({ port: 4173 });
  });

  test.each([
    undefined,
    "",
    "10.0.0.0",
    "10.0.0.0/15",
    "10.0.0.0/33",
    "10.0.0.0/16 trailing",
    "prefix 10.0.0.0/16",
    "junk/10.0.0.0/16",
    "10.0.0/16",
    "2001:db8::/32",
    "11.0.0.0/16",
    "11.16.0.0/16",
    "11.168.0.0/16",
    "172.15.0.0/16",
    "172.32.0.0/16",
    "192.167.0.0/16",
    "192.169.0.0/16",
  ])("rejects unsafe production proxy CIDR %s", (TRUST_PROXY) => {
    expect(() =>
      validateServerConfiguration({ ...productionEnvironment, TRUST_PROXY }),
    ).toThrow(
      "TRUST_PROXY must be one private IPv4 Docker network CIDR with a prefix from 16 through 32",
    );
  });

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
