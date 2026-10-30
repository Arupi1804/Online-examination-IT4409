import { z } from 'zod';

export const AuthRole = z.enum(['ADMIN', 'TEACHER', 'STUDENT']);
export const AuthUser = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string(),
  role: AuthRole,
});
export type AuthUser = z.infer<typeof AuthUser>;

export const AuthEmail = z.string().trim().toLowerCase().email().max(254);
const Password = z
  .string()
  .min(12)
  .max(72)
  .refine(
    (value) => new TextEncoder().encode(value).length <= 72,
    'Password must contain at most 72 UTF-8 bytes',
  );
// Public registration never accepts a client-supplied role.
export const RegisterRequest = z
  .object({
    email: AuthEmail,
    password: Password,
    name: z.string().trim().min(1).max(100),
  })
  .strict();
export type RegisterRequest = z.infer<typeof RegisterRequest>;
export const LoginRequest = z
  .object({
    email: AuthEmail,
    password: z
      .string()
      .min(1)
      .max(72)
      .refine(
        (value) => new TextEncoder().encode(value).length <= 72,
        'Password must contain at most 72 UTF-8 bytes',
      ),
  })
  .strict();
export type LoginRequest = z.infer<typeof LoginRequest>;
export const AuthSessionResponse = z.object({
  user: AuthUser,
  csrfToken: z.string(),
});
export const AUTH = {
  COOKIE_NAME: 'connect.sid',
  CSRF_HEADER: 'x-csrf-token',
  SESSION_IDLE_TTL_SEC: 28_800,
} as const;
