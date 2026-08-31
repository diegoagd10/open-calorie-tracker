import { describe, expect, test } from "vitest";

import {
  loginSchema,
  passwordChangeSchema,
  registrationSchema,
} from "../app/auth/validation";

describe("authentication input validation", () => {
  test.each([
    ["AbC", "abc"],
    ["A._-9", "a._-9"],
    ["A".repeat(30), "a".repeat(30)],
  ])("accepts and normalizes the username %s", (username, normalized) => {
    expect(loginSchema.parse({ password: "present", username })).toEqual({
      password: "present",
      username: normalized,
    });
  });

  test.each([
    "ab",
    "a".repeat(31),
    "has space",
    "jalapeño",
    "slash/name",
  ])("rejects the username %s", (username) => {
    expect(loginSchema.safeParse({ password: "present", username }).success)
      .toBe(false);
  });

  test("login requires a non-empty password", () => {
    expect(loginSchema.safeParse({ password: "", username: "valid" }).success)
      .toBe(false);
  });

  test.each([
    ["a".repeat(11), false],
    ["a".repeat(12), true],
    ["🔐".repeat(12), true],
    ["a".repeat(128), true],
    ["a".repeat(129), false],
  ] as const)(
    "registration password code-point boundary has expected validity",
    (password, success) => {
      expect(
        registrationSchema.safeParse({
          confirmPassword: password,
          password,
          username: "valid-user",
        }).success,
      ).toBe(success);
    },
  );

  test("password length failures expose the stable validation contract", () => {
    const result = passwordChangeSchema.safeParse({
      currentPassword: "current",
      newPassword: "too short",
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("short password was accepted");
    expect(result.error.issues[0]).toMatchObject({
      code: "custom",
      message: "invalid password length",
      path: ["newPassword"],
    });
  });

  test("registration identifies confirmation mismatches", () => {
    const result = registrationSchema.safeParse({
      confirmPassword: "different password",
      password: "correct horse battery staple",
      username: "valid-user",
    });

    expect(result.success).toBe(false);
    if (result.success) throw new Error("mismatched passwords were accepted");
    expect(result.error.issues).toContainEqual(
      expect.objectContaining({
        code: "custom",
        message: "passwords do not match",
        path: ["confirmPassword"],
      }),
    );
  });

  test("password changes require both the current and a valid new password", () => {
    expect(
      passwordChangeSchema.safeParse({
        currentPassword: "",
        newPassword: "a".repeat(12),
      }).success,
    ).toBe(false);
    expect(
      passwordChangeSchema.safeParse({
        currentPassword: "current",
        newPassword: "a".repeat(11),
      }).success,
    ).toBe(false);
    expect(
      passwordChangeSchema.parse({
        currentPassword: "current",
        newPassword: "a".repeat(12),
      }),
    ).toEqual({ currentPassword: "current", newPassword: "a".repeat(12) });
  });
});
