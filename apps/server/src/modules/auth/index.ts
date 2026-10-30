import { createHmac } from 'node:crypto';
import { Router, type RequestHandler } from 'express';
import { AuthUser, LoginRequest, RegisterRequest } from '@online-exam/shared';
import { AuthError } from './errors.js';
import { AuthSessions, newCsrfToken } from './session.js';
import type { AuthRepository } from './types.js';
import { bcryptPasswords, type PasswordHasher } from './services/password.js';

export { AuthSessions } from './session.js';
export { AuthSessionStore } from './services/session-store.js';
export { PrismaAuthRepository } from './services/repository.js';
export type { AuthRepository, Principal } from './types.js';

const wrap =
  (fn: RequestHandler): RequestHandler =>
  (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
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
  router.use(sessions.sessionMiddleware);
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  const digest = (value: string) =>
    createHmac('sha256', options.rateLimitSecret).update(value).digest('hex');

  router.get(
    '/csrf',
    wrap(async (req, res) => {
      req.session.csrfToken ??= newCsrfToken();
      await sessions.save(req);
      res.json({ data: { csrfToken: req.session.csrfToken } });
    }),
  );

  router.post(
    '/register',
    wrap(async (req, res) => {
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
      res.status(201).json({ data: { user } });
    }),
  );

  router.post(
    '/login',
    wrap(async (req, res) => {
      const input = LoginRequest.parse(req.body);
      const store = sessions.sessionStore;
      await store.consumeLimit(
        [
          `${store.keyPrefix}:rl:login:ip:${digest(req.ip ?? 'unknown')}`,
          `${store.keyPrefix}:rl:login:account:${digest(input.email)}`,
        ],
        [30, 5],
      );
      const user = await repository.findByEmail(input.email);
      const valid = await passwords.verify(
        input.password,
        user?.passwordHash ?? dummyHash,
      );
      if (!user || !valid)
        throw new AuthError(
          401,
          'AUTH_INVALID_CREDENTIALS',
          'Invalid email or password',
        );
      await sessions.establish(req, user);
      res.json({
        data: { user: AuthUser.parse(user), csrfToken: req.session.csrfToken },
      });
    }),
  );

  router.get(
    '/me',
    sessions.requireUser,
    wrap(async (req, res) => {
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
      res.json({ data: { user, csrfToken: req.session.csrfToken } });
    }),
  );

  router.post(
    '/logout',
    sessions.requireUser,
    wrap(async (req, res) => {
      await sessions.logout(req, res);
      res.status(204).end();
    }),
  );
  return router;
}
