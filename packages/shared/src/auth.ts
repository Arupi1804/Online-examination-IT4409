import { z } from 'zod';

export const AuthRole = z.enum(['ADMIN', 'TEACHER', 'STUDENT']);
export const AuthUser = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  role: AuthRole,
});
export type AuthUser = z.infer<typeof AuthUser>;

export const AuthEmail = z
  .string()
  .email()
  .transform((email) => email.toLowerCase());
const Password = z
  .string()
  .refine(
    (value) => [...value].length >= 8 && [...value].length <= 72,
    'Password must contain 8 to 72 characters',
  );
// OpenAPI permits extra fields: strip them instead of accepting a client-supplied role.
export const RegisterRequest = z.object({
  email: z
    .string()
    .email()
    .max(254)
    .transform((email) => email.toLowerCase()),
  password: Password,
  name: z
    .string()
    .refine(
      (value) => [...value].length >= 1 && [...value].length <= 100,
      'Name must contain 1 to 100 characters',
    ),
});
export type RegisterRequest = z.infer<typeof RegisterRequest>;
export const LoginRequest = z.object({
  email: AuthEmail,
  password: z.string(),
});
export type LoginRequest = z.infer<typeof LoginRequest>;
export const AuthSessionResponse = z.object({ data: AuthUser });
export const AUTH = {
  COOKIE_NAME: 'connect.sid',
  SESSION_IDLE_TTL_SEC: 28_800,
} as const;
