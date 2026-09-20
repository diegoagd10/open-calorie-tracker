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

export const fallbackPasswordChangeSchema = z.object({
  confirmNewPassword: z.string(),
  newPassword: passwordSchema,
}).superRefine((change, context) => {
  if (change.newPassword !== change.confirmNewPassword)
    context.addIssue({ code: "custom", message: "passwords do not match", path: ["confirmNewPassword"] });
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

const credentialIdentifier = z.string().regex(/^[A-Za-z0-9_-]+$/).max(1024);
const encodedClientData = z.string().regex(/^[A-Za-z0-9_-]+$/).max(8192);
const credentialEnvelope = {
  id: credentialIdentifier,
  rawId: credentialIdentifier,
  type: z.literal("public-key"),
  clientExtensionResults: z.record(z.string(), z.unknown()),
};
export const keyRegistrationResponseSchema = z.object({
  ...credentialEnvelope,
  response: z.object({
    clientDataJSON: encodedClientData,
    attestationObject: z.string().regex(/^[A-Za-z0-9_-]+$/).max(24_000),
    transports: z.array(z.string().max(32)).max(8).optional(),
  }),
});
export const keyAssertionResponseSchema = z.object({
  ...credentialEnvelope,
  response: z.object({
    clientDataJSON: encodedClientData,
    authenticatorData: z.string().regex(/^[A-Za-z0-9_-]+$/).max(8192),
    signature: z.string().regex(/^[A-Za-z0-9_-]+$/).max(2048),
    userHandle: z.string().regex(/^[A-Za-z0-9_-]+$/).max(128).optional(),
  }),
});
