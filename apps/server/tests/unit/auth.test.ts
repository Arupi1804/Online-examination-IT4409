import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { LoginRequest, RegisterRequest } from '@online-exam/shared';
import { AuthSessions } from '../../src/modules/auth/session.js';
import { AuthSessionStore } from '../../src/modules/auth/services/session-store.js';
import { createClient } from 'redis';

describe('Auth contract and RBAC', () => {
  it('normalizes emails, rejects privileged registration and bcrypt-truncated input', () => {
    expect(
      LoginRequest.parse({ email: ' USER@EXAMPLE.TEST ', password: 'x' }).email,
    ).toBe('user@example.test');
    expect(
      RegisterRequest.safeParse({
        email: 'user@example.test',
        password: 'a-long-enough-password',
        name: 'User',
        role: 'ADMIN',
      }).success,
    ).toBe(false);
    expect(
      RegisterRequest.safeParse({
        email: 'user@example.test',
        password: '🔥'.repeat(20),
        name: 'User',
      }).success,
    ).toBe(false);
  });
  it('requires authentication and the allowed role before entering protected handlers', () => {
    const sessions = new AuthSessions({
      store: new AuthSessionStore(createClient(), 'test'),
      secret: 'a-test-secret-long-enough-for-session',
      clientOrigin: 'http://localhost:5173',
      secureCookie: false,
    });
    const middleware = sessions.requireRoles('TEACHER');
    const next = vi.fn();
    middleware({} as Request, {} as Response, next);
    expect(next).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 401 }),
    );
    middleware(
      { principal: { role: 'STUDENT' } } as Request,
      {} as Response,
      next,
    );
    expect(next).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: 403 }),
    );
    middleware(
      { principal: { role: 'TEACHER' } } as Request,
      {} as Response,
      next,
    );
    expect(next).toHaveBeenLastCalledWith();
  });
});
