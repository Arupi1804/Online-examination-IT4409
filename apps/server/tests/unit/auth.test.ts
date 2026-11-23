import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';
import { LoginRequest, RegisterRequest } from '@online-exam/shared';
import { AuthSessions } from '../../src/modules/auth/session.js';
import { AuthSessionStore } from '../../src/modules/auth/services/session-store.js';
import { createClient } from 'redis';
import { bcryptPasswords } from '../../src/modules/auth/services/password.js';

describe('Auth contract and RBAC', () => {
  it('uses core-openapi input limits, strips role and normalizes email casing', () => {
    expect(
      LoginRequest.parse({ email: 'USER@EXAMPLE.TEST', password: '' }).email,
    ).toBe('user@example.test');
    expect(
      RegisterRequest.safeParse({
        email: 'user@example.test',
        password: 'a-long-enough-password',
        name: 'User',
        role: 'ADMIN',
      }).success,
    ).toBe(true);
    expect(
      RegisterRequest.safeParse({
        email: 'user@example.test',
        password: '🔥'.repeat(20),
        name: 'User',
      }).success,
    ).toBe(true);
    expect(
      RegisterRequest.parse({
        email: 'user@example.test',
        password: '12345678',
        name: 'User',
        role: 'ADMIN',
      }),
    ).not.toHaveProperty('role');
    expect(
      RegisterRequest.safeParse({
        email: 'user@example.test',
        password: '1234567',
        name: 'User',
      }).success,
    ).toBe(false);
    expect(
      RegisterRequest.safeParse({
        email: 'user@example.test',
        password: '12345678',
        name: '🔥'.repeat(100),
      }).success,
    ).toBe(true);
    expect(
      RegisterRequest.safeParse({
        email: 'user@example.test',
        password: '12345678',
        name: '🔥'.repeat(101),
      }).success,
    ).toBe(false);
  });
  it('preserves bcrypt credentials and avoids truncating valid Unicode passwords', async () => {
    const passwords = bcryptPasswords(4);
    const legacy = await passwords.hash('12345678');
    expect(legacy).toMatch(/^\$2[ab]\$/);
    expect(await passwords.verify('12345678', legacy)).toBe(true);
    expect(await passwords.verify('12345678' + 'x'.repeat(73), legacy)).toBe(
      false,
    );
    const long = '🔥'.repeat(72);
    const hash = await passwords.hash(long);
    expect(await passwords.verify(long, hash)).toBe(true);
    expect(await passwords.verify('🔥'.repeat(71) + 'x', hash)).toBe(false);
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
