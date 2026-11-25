import { apiFetch, ApiError } from '../../services/api.ts';
import {
  authResponseSchema,
  loginFormSchema,
  registrationFormSchema,
} from './auth-schema.ts';
import type { AuthService } from './auth-model.ts';

export function createApiAuthService(): AuthService {
  return {
    async me() {
      try {
        return authResponseSchema.parse(
          await apiFetch<unknown>('/api/v1/auth/me'),
        ).data;
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    async login({ email, password }) {
      const input = loginFormSchema.parse({ email, password });
      return authResponseSchema.parse(
        await apiFetch('/api/v1/auth/login', {
          method: 'POST',
          body: JSON.stringify(input),
        }),
      ).data;
    },
    async register({ name, email, password }) {
      // Role is exclusively assigned by the server; confirmation is UI-only.
      const input = registrationFormSchema.parse({ name, email, password });
      authResponseSchema.parse(
        await apiFetch('/api/v1/auth/register', {
          method: 'POST',
          body: JSON.stringify(input),
        }),
      );
    },
    async logout() {
      try {
        await apiFetch('/api/v1/auth/logout', { method: 'POST' });
      } catch (error) {
        // An expired/replaced session is already logged out on the server.
        if (!(error instanceof ApiError && error.status === 401)) throw error;
      }
    },
  };
}
