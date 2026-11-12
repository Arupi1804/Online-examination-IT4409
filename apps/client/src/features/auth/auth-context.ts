import { createContext } from 'react';
import type { AuthService, AuthUser } from './auth-model';

export interface AuthContextValue {
  user: AuthUser | null;
  checking: boolean;
  sessionError: string;
  retrySession(): void;
  login: AuthService['login'];
  register: AuthService['register'];
  logout: AuthService['logout'];
}
export const AuthContext = createContext<AuthContextValue | null>(null);
