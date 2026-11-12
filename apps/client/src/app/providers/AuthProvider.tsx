import { useEffect, useState, type ReactNode } from 'react';
import { AuthContext } from '@/features/auth/auth-context';
import { authService } from '@/features/auth/auth-service';
import { getAuthErrorMessage } from '@/features/auth/auth-errors';
import type {
  AuthUser,
  LoginInput,
  RegisterInput,
} from '@/features/auth/auth-model';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [checking, setChecking] = useState(true);
  const [sessionError, setSessionError] = useState('');
  const [sessionAttempt, setSessionAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    authService
      .me()
      .then((current) => {
        if (active) {
          setUser(current);
          setSessionError('');
        }
      })
      .catch((error: unknown) => {
        if (active) setSessionError(getAuthErrorMessage(error));
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [sessionAttempt]);

  async function login(input: LoginInput) {
    const current = await authService.login(input);
    setUser(current);
    setSessionError('');
    return current;
  }
  async function register(input: RegisterInput) {
    await authService.register(input);
  }
  async function logout() {
    await authService.logout();
    setUser(null);
    setSessionError('');
  }
  function retrySession() {
    setChecking(true);
    setSessionError('');
    setSessionAttempt((attempt) => attempt + 1);
  }
  return (
    <AuthContext.Provider
      value={{
        user,
        checking,
        sessionError,
        retrySession,
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
