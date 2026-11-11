import { createHmac } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { AuthUser, LoginRequest, RegisterRequest } from '@online-exam/shared';
import { AuthError } from './errors.js';
import { AuthSessions } from './session.js';
import type { AuthRepository } from './types.js';
import { bcryptPasswords, type PasswordHasher } from './services/password.js';
import { handle } from '../../core/http/error-handler.js';

export { AuthSessions } from './session.js';
export { AuthSessionStore } from './services/session-store.js';
export { PrismaAuthRepository } from './services/repository.js';
export type { AuthRepository, Principal } from './types.js';

const requireJson: RequestHandler = (req, _res, next) => {
  if (!req.is('application/json')) {
    next(
      new AuthError(
        400,
        'VALIDATION_FAILED',
        'Content-Type must be application/json',
      ),
    );
    return;
  }
  next();
};

export async function createAuthRouter(options: {
  sessions: AuthSessions;
  repository: AuthRepository;
  rateLimitSecret: string;
  passwords?: PasswordHasher;
}) {
  const { sessions, repository } = options;
  const passwords = options.passwords ?? bcryptPasswords();
  const dummyHash = await passwords.hash('dummy-password-for-auth-timing');
  const router = Router();
  const digest = (value: string) =>
    createHmac('sha256', options.rateLimitSecret).update(value).digest('hex');

  router.post(
    '/register',
    requireJson,
    handle(async (req, res) => {
      const input = RegisterRequest.parse(req.body);
      const store = sessions.sessionStore;
      await store.consumeLimit(
        [`${store.keyPrefix}:rl:register:ip:${digest(req.ip ?? 'unknown')}`],
        [20],
      );
      const user = await repository.createStudent({
        email: input.email,
        name: input.name,
        passwordHash: await passwords.hash(input.password),
      });
      res.status(201).json({ data: AuthUser.parse(user) });
    }),
  );

  router.post(
    '/login',
    requireJson,
    handle(async (req, res) => {
      const input = LoginRequest.parse(req.body);
      const store = sessions.sessionStore;
      await store.consumeLimit(
        [`${store.keyPrefix}:rl:login:ip:${digest(req.ip ?? 'unknown')}`],
        [30],
      );
      const accountKey = `${store.keyPrefix}:rl:login:account:${digest(input.email)}`;
      const failures = await store.checkLoginFailures(accountKey);
      const user = await repository.findByEmail(input.email);
      const valid = await passwords.verify(
        input.password,
        user?.passwordHash ?? dummyHash,
      );
      if (!user || !valid) {
        await store.consumeLimit([accountKey], [5]);
        throw new AuthError(
          401,
          'AUTH_INVALID_CREDENTIALS',
          'Invalid email or password',
        );
      }
      await store.resetLoginFailures(accountKey, failures);
      await sessions.establish(req, user);
      res.json({
        data: AuthUser.parse(user),
      });
    }),
  );

  router.get(
    '/me',
    sessions.requireUser,
    handle(async (req, res) => {
      const user = await repository.findById(req.principal!.userId);
      if (!user) {
        await sessions.logout(req, res);
        throw new AuthError(
          401,
          'AUTH_SESSION_EXPIRED',
          'Account no longer exists',
        );
      }
      if (user.role !== req.principal!.role) {
        await sessions.logout(req, res);
        throw new AuthError(
          401,
          'AUTH_SESSION_EXPIRED',
          'Account permissions changed',
        );
      }
      res.json({ data: AuthUser.parse(user) });
    }),
  );

  router.post(
    '/logout',
    sessions.requireUser,
    handle(async (req, res) => {
      await sessions.logout(req, res);
      res.status(204).end();
    }),
  );
  return router;
}
