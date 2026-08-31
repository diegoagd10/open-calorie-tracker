import { expect, test } from "vitest";

import { parseCookies } from "../app/auth/http.server";

test("cookie parsing decodes valid pairs and ignores malformed input", () => {
  expect(
    parseCookies(
      "__Host-calorie_session=session%20token; flag; malformed=%E0%A4%A; theme=dark",
    ),
  ).toEqual(
    new Map([
      ["__Host-calorie_session", "session token"],
      ["theme", "dark"],
    ]),
  );
  expect(parseCookies(null)).toEqual(new Map());
});
