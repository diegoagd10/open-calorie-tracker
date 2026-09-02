import { z } from "zod";

export const usernameSchema = z
  .string()
  .regex(/^[A-Za-z0-9._-]{3,30}$/)
  .transform((username) => username.toLowerCase());

const passwordSchema = z.string().superRefine((password, context) => {
  const characterCount = Array.from(password).length;
  if (characterCount < 12 || characterCount > 128) {
    context.addIssue({ code: "custom", message: "invalid password length" });
  }
});

export const loginSchema = z.object({
  password: z.string().min(1),
  username: usernameSchema,
});

export const passwordChangeSchema = z
  .object({
    confirmNewPassword: z.string(),
    currentPassword: z.string().min(1),
    newPassword: passwordSchema,
  })
  .superRefine((passwordChange, context) => {
    if (passwordChange.newPassword !== passwordChange.confirmNewPassword) {
      context.addIssue({
        code: "custom",
        message: "passwords do not match",
        path: ["confirmNewPassword"],
      });
    }
  });

export const memberPasswordResetSchema = z
  .object({
    confirmPassword: z.string(),
    newPassword: passwordSchema,
    targetUsername: usernameSchema,
  })
  .superRefine((reset, context) => {
    if (reset.newPassword !== reset.confirmPassword) {
      context.addIssue({
        code: "custom",
        message: "passwords do not match",
        path: ["confirmPassword"],
      });
    }
  });

export const registrationSchema = z
  .object({
    confirmPassword: z.string(),
    password: passwordSchema,
    username: usernameSchema,
  })
  .superRefine((registration, context) => {
    if (registration.password !== registration.confirmPassword) {
      context.addIssue({
        code: "custom",
        message: "passwords do not match",
        path: ["confirmPassword"],
      });
    }
  });
