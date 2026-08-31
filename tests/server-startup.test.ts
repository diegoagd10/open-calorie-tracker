import { describe, expect, test } from "vitest";

import { validateServerConfiguration } from "../server/startup-configuration.js";

describe("server startup configuration", () => {
  test("accepts a private production proxy and returns the listening port", () => {
    expect(
      validateServerConfiguration({
        APPLICATION_URL: "https://calories.example.test",
        NODE_ENV: "production",
        PORT: "4173",
        TRUST_PROXY: "172.30.0.0/16",
      }),
    ).toEqual({ port: 4173 });
  });
});
