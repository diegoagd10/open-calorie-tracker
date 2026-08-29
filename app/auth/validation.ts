import { z } from "zod";

const usernameSchema = z
  .string()
  .trim()
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
