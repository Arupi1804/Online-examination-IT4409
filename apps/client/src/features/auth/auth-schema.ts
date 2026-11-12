import { z } from 'zod';

// Frontend form validation and response parsing follow dev/docs/openapi.yaml.
const emailField = z
  .string()
  .email()
  .transform((value) => value.toLowerCase());
const characterCount = (value: string) => Array.from(value).length;

export const loginFormSchema = z.object({
  email: emailField,
  password: z.string(),
});
export const registrationFormSchema = loginFormSchema.extend({
  email: z
    .string()
    .email()
    .max(254)
    .transform((value) => value.toLowerCase()),
  name: z
    .string()
    .refine(
      (value) => characterCount(value) >= 1 && characterCount(value) <= 100,
    ),
  password: z
    .string()
    .refine(
      (value) => characterCount(value) >= 8 && characterCount(value) <= 72,
    ),
});

export const authProfileSchema = z.object({
  id: z.string().uuid(),
  email: emailField,
  name: z.string(),
  role: z.enum(['ADMIN', 'TEACHER', 'STUDENT']),
});
export const authResponseSchema = z.object({ data: authProfileSchema });
