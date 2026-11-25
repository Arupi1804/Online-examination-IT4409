import type { AuthService } from './auth-model.ts';
import { createApiAuthService } from './api-auth-service.ts';

export const isAuthMock =
  import.meta.env.DEV && import.meta.env.VITE_USE_MOCK === 'true';

// Mock is never selected in production, even if VITE_USE_MOCK=true.
export const authService: AuthService = isAuthMock
  ? (await import('./mock-auth-service.ts')).createMockAuthService()
  : createApiAuthService();
