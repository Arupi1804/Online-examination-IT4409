import type { z } from 'zod';
import type {
  authProfileSchema,
  loginFormSchema,
  registrationFormSchema,
} from './auth-schema';

export type AuthUser = z.infer<typeof authProfileSchema>;
export type AuthMode = 'login' | 'register';
export interface AuthFormValues {
  name: string;
  email: string;
  password: string;
  confirmPassword: string;
}
export type AuthFieldName = keyof AuthFormValues;
export type AuthFieldErrors = Partial<Record<AuthFieldName, string>>;
export type LoginInput = z.infer<typeof loginFormSchema>;
export type RegisterInput = z.infer<typeof registrationFormSchema>;

export interface AuthService {
  me(): Promise<AuthUser | null>;
  login(input: LoginInput): Promise<AuthUser>;
  register(input: RegisterInput): Promise<void>;
  logout(): Promise<void>;
}
