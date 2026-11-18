import { createHmac, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { Router } from 'express';
import request from 'supertest';
import { createClient } from 'redis';
import { Server } from 'socket.io';
import { io as connect, type Socket } from 'socket.io-client';
import type { AuthUser } from '@online-exam/shared';
import { createApp } from '../../src/app.js';
import {
  AuthSessions,
  AuthSessionStore,
  createAuthRouter,
  type AuthRepository,
} from '../../src/modules/auth/index.js';
import { bcryptPasswords } from '../../src/modules/auth/services/password.js';
import { AuthError } from '../../src/modules/auth/errors.js';

const origin = 'http://localhost:5173';
const password = 'Test-password-2026';
const redisUrl = process.env.AUTH_REDIS_URL;
type Agent = ReturnType<typeof request.agent>;

describe.skipIf(!redisUrl)('Auth HTTP + real Redis + Socket.IO', () => {
  const prefix = `oe:dev:v1:test:${randomUUID()}`;
  const redis = createClient({
    url: redisUrl,
    socket: { reconnectStrategy: false },
  });
  const users = new Map<string, AuthUser & { passwordHash: string }>();
  const repository: AuthRepository = {
    findByEmail: async (email) => users.get(email) ?? null,
    findById: async (id) => {
      const user = [...users.values()].find((user) => user.id === id);
      return user
        ? { id: user.id, email: user.email, name: user.name, role: user.role }
        : null;
    },
    createStudent: async (input) => {
      if (users.has(input.email))
        throw new AuthError(409, 'EMAIL_TAKEN', 'Email is already registered');
      const user = { ...input, id: randomUUID(), role: 'STUDENT' as const };
      users.set(input.email, user);
      return {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      };
    },
  };
  const store = new AuthSessionStore(redis, prefix);
  const passwords = bcryptPasswords(4);
  const sessions = new AuthSessions({
    store,
    secret: 'test-secret-with-at-least-thirty-two-characters',
    clientOrigin: origin,
    secureCookie: false,
  });
  let app: ReturnType<typeof createApp>;
  const server = createServer();
  let io: Server;
  let socketUrl: string;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    await redis.connect();
    const authRouter = await createAuthRouter({
      sessions,
      repository,
      rateLimitSecret: 'test-rate-secret',
      passwords,
    });
    const apiRouter = Router();
    apiRouter.get('/principal', sessions.requireUser, (req, res) =>
      res.json({ data: { id: req.principal!.id, role: req.principal!.role } }),
    );
    apiRouter.post('/principal', sessions.requireUser, (_req, res) =>
      res.json({ data: { ok: true } }),
    );
    apiRouter.get('/teacher', sessions.requireRoles('TEACHER'), (_req, res) =>
      res.json({ data: { ok: true } }),
    );
    app = createApp(origin, {
      authRouter,
      apiRouter,
      sessionMiddleware: sessions.sessionMiddleware,
    });
    server.on('request', app);
    io = new Server(server);
    io.engine.use((req, res, next) =>
      sessions.socketSessionMiddleware(
        req as Parameters<typeof sessions.socketSessionMiddleware>[0],
        res as Parameters<typeof sessions.socketSessionMiddleware>[1],
        next,
      ),
    );
    const namespace = io.of('/exam');
    sessions.attachSocketAuthentication(namespace);
    namespace.on('connection', (socket) =>
      socket.on('probe', (ack: (value: unknown) => void) => ack({ ok: true })),
    );
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing test port');
    socketUrl = `http://127.0.0.1:${address.port}/exam`;
  });
  beforeEach(async () => {
    vi.restoreAllMocks();
    sockets.splice(0).forEach((socket) => socket.disconnect());
    users.clear();
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length) await redis.del(keys);
  });
  afterAll(async () => {
    sockets.forEach((socket) => socket.disconnect());
    await new Promise<void>((resolve) => io.close(() => resolve()));
    const keys = await redis.keys(`${prefix}:*`);
    if (keys.length) await redis.del(keys);
    await redis.quit();
  });

  async function register(agent: Agent, email = 'student@example.test') {
    return agent
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .send({ email, name: 'Student', password })
      .expect(201);
  }
  async function login(agent: Agent, email = 'student@example.test') {
    return agent
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .send({ email, password })
      .expect(200);
  }
  function accountKey(email = 'student@example.test') {
    const digest = createHmac('sha256', 'test-rate-secret')
      .update(email.toLowerCase())
      .digest('hex');
    return `${prefix}:rl:login:account:${digest}`;
  }
  function cookie(response: request.Response): string {
    return (response.headers['set-cookie'] as unknown as string[])[0]!.split(
      ';',
    )[0]!;
  }
  async function socketFor(cookieValue?: string) {
    const socket = connect(socketUrl, {
      transports: ['websocket'],
      extraHeaders: cookieValue ? { cookie: cookieValue } : {},
      reconnection: false,
      forceNew: true,
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
    return socket;
  }

  it('registers STUDENT only, hashes passwords and never returns the hash', async () => {
    const agent = request.agent(app);
    const submittedRole = await agent
      .post('/api/v1/auth/register')
      .send({
        email: 'admin@example.test',
        name: 'Admin',
        password: '12345678',
        role: 'ADMIN',
      })
      .expect(201);
    expect(submittedRole.body.data.role).toBe('STUDENT');
    expect(submittedRole.body.data).not.toHaveProperty('passwordHash');
    const created = await register(agent, 'Student@Example.Test');
    expect(created.body.data).toMatchObject({
      email: 'student@example.test',
      role: 'STUDENT',
    });
    expect(created.body.data).not.toHaveProperty('passwordHash');
    expect(users.get('student@example.test')!.passwordHash).not.toBe(password);
    const duplicate = await agent
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .send({ email: 'student@example.test', name: 'Again', password })
      .expect(409);
    expect(duplicate.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('supports the core Auth flow without a CSRF bootstrap and rotates the login cookie', async () => {
    const agent = request.agent(app);
    await agent.get('/api/v1/auth/csrf').expect(404);
    await register(agent);
    const first = await login(agent);
    const loggedIn = await agent
      .post('/api/v1/auth/login')
      .send({ email: 'student@example.test', password })
      .expect(200);
    expect(cookie(loggedIn)).not.toBe(cookie(first));
    expect(loggedIn.headers['set-cookie'].join(';')).toContain('HttpOnly');
    expect(loggedIn.headers['set-cookie'].join(';')).toContain('SameSite=Lax');
    expect(Object.keys(loggedIn.body)).toEqual(['data']);
    expect(Object.keys(loggedIn.body.data).sort()).toEqual([
      'email',
      'id',
      'name',
      'role',
    ]);
    const me = await agent.get('/api/v1/auth/me').expect(200);
    expect(me.body).toEqual(loggedIn.body);
    await agent.post('/api/v1/auth/logout').expect(204);
    await agent.get('/api/v1/auth/me').expect(401);
  });

  it('blocks cross-site browser requests and form logins without requiring custom headers', async () => {
    const agent = request.agent(app);
    await register(agent);
    const wrongOrigin = await agent
      .post('/api/v1/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ email: 'student@example.test', password })
      .expect(403);
    expect(wrongOrigin.body.error.code).toBe('FORBIDDEN');
    await agent
      .post('/api/v1/auth/login')
      .set('Sec-Fetch-Site', 'cross-site')
      .send({ email: 'student@example.test', password })
      .expect(403);
    await agent
      .post('/api/v1/auth/login')
      .set('Referer', 'https://evil.example/attack')
      .send({ email: 'student@example.test', password })
      .expect(403);
    await agent
      .post('/api/v1/auth/login')
      .type('form')
      .send({ email: 'student@example.test', password })
      .expect(400);
    const loggedIn = await login(agent);
    await agent
      .post('/api/v1/auth/logout')
      .set('Origin', 'https://evil.example')
      .expect(403);
    await agent.get('/api/v1/auth/me').expect(200);
    const sid = (await redis.get(store.activeKey(loggedIn.body.data.id)))!;
    expect(await redis.get(store.sessionPrefix + sid)).toBeTruthy();
  });

  it('matches RegisterInput limits and allows string passwords on LoginInput', async () => {
    const agent = request.agent(app);
    for (const value of ['short12', 'x'.repeat(73)]) {
      const response = await agent
        .post('/api/v1/auth/register')
        .send({
          email: 'invalid@example.test',
          name: 'Invalid',
          password: value,
        })
        .expect(400);
      expect(response.body.error.code).toBe('VALIDATION_FAILED');
    }
    await agent
      .post('/api/v1/auth/register')
      .send({
        email: 'unicode@example.test',
        name: 'Unicode',
        password: '\u{1F525}'.repeat(72),
      })
      .expect(201);
    await agent
      .post('/api/v1/auth/login')
      .send({ email: 'unicode@example.test', password: '\u{1F525}'.repeat(72) })
      .expect(200);
    const wrongSuffix = await agent
      .post('/api/v1/auth/login')
      .send({
        email: 'unicode@example.test',
        password: '\u{1F525}'.repeat(71) + 'x',
      })
      .expect(401);
    expect(wrongSuffix.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    for (const value of ['', 'x'.repeat(100)]) {
      const response = await agent
        .post('/api/v1/auth/login')
        .send({ email: 'missing@example.test', password: value })
        .expect(401);
      expect(response.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    }
  });

  it('replaces the old session, disconnects its socket and prevents stale saves/deletes', async () => {
    const first = request.agent(app);
    const second = request.agent(app);
    await register(first);
    const loginA = await login(first);
    const id = loginA.body.data.id as string;
    const oldSid = (await redis.get(store.activeKey(id)))!;
    const oldData = (await sessions.readSession(oldSid))!;
    const socket = await socketFor(cookie(loginA));
    const replaced = new Promise<void>((resolve) =>
      socket.once('session:replaced', () => resolve()),
    );
    const disconnected = new Promise<void>((resolve) =>
      socket.once('disconnect', () => resolve()),
    );
    await login(second);
    await Promise.all([replaced, disconnected]);
    const newSid = (await redis.get(store.activeKey(id)))!;
    expect(newSid).not.toBe(oldSid);
    await expect(
      new Promise<void>((resolve, reject) =>
        store.set(oldSid, oldData, (error) =>
          error ? reject(error) : resolve(),
        ),
      ),
    ).rejects.toMatchObject({ code: 'AUTH_SESSION_REPLACED' });
    await new Promise<void>((resolve, reject) =>
      store.destroy(oldSid, (error) => (error ? reject(error) : resolve())),
    );
    expect(await redis.get(store.activeKey(id))).toBe(newSid);
    expect(await redis.get(store.sessionPrefix + oldSid)).toBeNull();
    await first.get('/api/v1/auth/me').expect(401);
    await second.get('/api/v1/auth/me').expect(200);
  });

  it('renews cookie/session/pointer together on HTTP, never from socket traffic', async () => {
    const agent = request.agent(app);
    await register(agent);
    const loggedIn = await login(agent);
    const userId = loggedIn.body.data.id as string;
    const sid = (await redis.get(store.activeKey(userId)))!;
    const sessionKey = store.sessionPrefix + sid;
    const activeKey = store.activeKey(userId);
    const data = (await sessions.readSession(sid))!;
    data.cookie.expires = new Date(Date.now() + 60_000);
    await redis.set(sessionKey, JSON.stringify(data), { PX: 60_000 });
    await redis.pExpire(activeKey, 60_000);
    const socket = await socketFor(cookie(loggedIn));
    await socket.emitWithAck('probe');
    expect(await redis.pTTL(activeKey)).toBeLessThanOrEqual(60_000);
    expect(await redis.pTTL(sessionKey)).toBeLessThanOrEqual(60_000);
    const me = await agent.get('/api/v1/auth/me').expect(200);
    expect(me.headers['set-cookie']).toBeDefined();
    expect(await redis.pTTL(activeKey)).toBeGreaterThan(28_790_000);
    expect(
      Math.abs((await redis.pTTL(sessionKey)) - (await redis.pTTL(activeKey))),
    ).toBeLessThan(100);
  });

  it('rejects anonymous/tampered socket cookies and expired sessions', async () => {
    await expect(socketFor()).rejects.toMatchObject({
      data: { code: 'AUTH_SESSION_EXPIRED' },
    });
    await expect(
      socketFor('connect.sid=s%3Afake.signature'),
    ).rejects.toMatchObject({ data: { code: 'AUTH_SESSION_EXPIRED' } });
    const agent = request.agent(app);
    await register(agent);
    const loggedIn = await login(agent);
    const sid = (await redis.get(store.activeKey(loggedIn.body.data.id)))!;
    await redis.del(store.sessionPrefix + sid);
    await agent.get('/api/v1/auth/me').expect(401);
    await expect(socketFor(cookie(loggedIn))).rejects.toMatchObject({
      data: { code: 'AUTH_SESSION_EXPIRED' },
    });
  });

  it('limits login attempts per normalized account', async () => {
    const agent = request.agent(app);
    for (let i = 0; i < 5; i++) {
      const failed = await agent
        .post('/api/v1/auth/login')
        .set('Origin', origin)
        .send({ email: 'missing@example.test', password })
        .expect(401);
      expect(failed.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    }
    const key = accountKey('missing@example.test');
    await redis.pExpire(key, 15_000);
    const blocked = await agent
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .send({ email: 'MISSING@EXAMPLE.TEST', password })
      .expect(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.headers['retry-after']).toBe('900');
    expect(await redis.get(key)).toBe('5');
    expect(await redis.pTTL(key)).toBeGreaterThan(0);
    expect(await redis.pTTL(key)).toBeLessThanOrEqual(15_000);
  });

  it('allows repeated successful logins without consuming the account failure budget', async () => {
    const agent = request.agent(app);
    await register(agent);
    for (let i = 0; i < 7; i++) await login(agent);
    expect(await redis.get(accountKey())).toBeNull();
    const keys = await redis.keys(`${prefix}:rl:login:ip:*`);
    expect(keys).toHaveLength(1);
    expect(await redis.get(keys[0]!)).toBe('7');
  });

  it('clears earlier account failures on success and preserves the IP counter', async () => {
    const agent = request.agent(app);
    await register(agent);
    for (let i = 0; i < 3; i++)
      await agent
        .post('/api/v1/auth/login')
        .send({ email: 'student@example.test', password: 'wrong-password' })
        .expect(401);
    expect(await redis.get(accountKey())).toBe('3');
    await login(agent);
    expect(await redis.get(accountKey())).toBeNull();
    const keys = await redis.keys(`${prefix}:rl:login:ip:*`);
    expect(await redis.get(keys[0]!)).toBe('4');
    await agent
      .post('/api/v1/auth/login')
      .send({ email: 'student@example.test', password: 'wrong-password' })
      .expect(401);
    expect(await redis.get(accountKey())).toBe('1');
  });

  it('blocks even a correct password before verification after five failed logins', async () => {
    const agent = request.agent(app);
    await register(agent);
    const verify = vi.spyOn(passwords, 'verify');
    for (let i = 0; i < 5; i++)
      await agent
        .post('/api/v1/auth/login')
        .send({ email: 'student@example.test', password: 'wrong-password' })
        .expect(401);
    await agent
      .post('/api/v1/auth/login')
      .send({ email: 'student@example.test', password })
      .expect(429);
    expect(verify).toHaveBeenCalledTimes(5);
  });

  it('retains the IP limit across successful logins', async () => {
    const agent = request.agent(app);
    await register(agent);
    const verify = vi.spyOn(passwords, 'verify');
    for (let i = 0; i < 30; i++) await login(agent);
    await agent
      .post('/api/v1/auth/login')
      .send({ email: 'student@example.test', password })
      .expect(429);
    expect(verify).toHaveBeenCalledTimes(30);
    expect(await redis.get(accountKey())).toBeNull();
  });

  it('counts concurrent failures atomically without losing the fixed-window TTL', async () => {
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        request(app)
          .post('/api/v1/auth/login')
          .send({ email: 'missing@example.test', password: 'wrong-password' }),
      ),
    );
    expect(
      responses.filter((response) => response.status === 401),
    ).toHaveLength(5);
    expect(
      responses.filter((response) => response.status === 429),
    ).toHaveLength(3);
    const key = accountKey('missing@example.test');
    expect(Number(await redis.get(key))).toBeGreaterThanOrEqual(5);
    expect(await redis.pTTL(key)).toBeGreaterThan(0);
    expect(await redis.pTTL(key)).toBeLessThanOrEqual(900_000);
  });

  it('does not reset failures added while a successful login is being verified', async () => {
    const agent = request.agent(app);
    await register(agent);
    await agent
      .post('/api/v1/auth/login')
      .send({ email: 'student@example.test', password: 'wrong-password' })
      .expect(401);
    let verificationStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      verificationStarted = resolve;
    });
    let releaseVerification!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseVerification = resolve;
    });
    const originalVerify = passwords.verify.bind(passwords);
    vi.spyOn(passwords, 'verify').mockImplementationOnce(async (...args) => {
      const valid = await originalVerify(...args);
      verificationStarted();
      await release;
      return valid;
    });
    const pending = agent
      .post('/api/v1/auth/login')
      .send({ email: 'student@example.test', password })
      .then((response) => response);
    try {
      await started;
      await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'student@example.test', password: 'wrong-password' })
        .expect(401);
    } finally {
      releaseVerification();
    }
    expect((await pending).status).toBe(200);
    expect(await redis.get(accountKey())).toBe('2');
  });

  it('does not erase a new failure window using an old successful-login snapshot', async () => {
    const key = accountKey();
    await store.consumeLimit([key], [5]);
    const snapshot = await store.checkLoginFailures(key);
    await redis.del(key);
    await redis.set(key, '1', { PX: 2000 });
    await store.resetLoginFailures(key, snapshot);
    expect(await redis.get(key)).toBe('1');
    expect(await redis.pTTL(key)).toBeGreaterThan(0);
    expect(await redis.pTTL(key)).toBeLessThanOrEqual(2000);
  });

  it('provides one shared principal and source checks to business routes', async () => {
    const agent = request.agent(app);
    await agent.get('/api/v1/principal').expect(401);
    await register(agent);
    const loggedIn = await login(agent);
    const save = vi.spyOn(sessions, 'save');
    const principal = await agent.get('/api/v1/principal').expect(200);
    expect(principal.body.data).toEqual({
      id: loggedIn.body.data.id,
      role: 'STUDENT',
    });
    expect(save).toHaveBeenCalledTimes(1);
    await agent.get('/api/v1/teacher').expect(403);
    await agent
      .post('/api/v1/principal')
      .set('Origin', 'https://evil.example')
      .expect(403);
    await agent.post('/api/v1/principal').set('Origin', origin).expect(200);
    users.get('student@example.test')!.role = 'TEACHER';
    await login(agent);
    await agent.get('/api/v1/teacher').expect(200);
  });

  it('keeps health public even when the cookie belongs to a revoked session', async () => {
    const agent = request.agent(app);
    await register(agent);
    const loggedIn = await login(agent);
    await redis.del(store.activeKey(loggedIn.body.data.id));
    const principal = vi.spyOn(sessions, 'getPrincipal');
    const health = await agent.get('/api/v1/health').expect(200);
    expect(principal).not.toHaveBeenCalled();
    expect(health.headers['set-cookie']).toBeUndefined();
  });

  it('requires JSON for both Auth writes after mounting the shared API middleware', async () => {
    for (const path of ['login', 'register']) {
      const form = await request(app)
        .post(`/api/v1/auth/${path}`)
        .set('Origin', origin)
        .type('form')
        .send({ email: 'student@example.test', password, name: 'Student' })
        .expect(400);
      expect(form.body.error.code).toBe('VALIDATION_FAILED');
      expect(form.headers['cache-control']).toBe('no-store');
    }
    const crossSite = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ email: 'student@example.test', password })
      .expect(403);
    expect(crossSite.headers['cache-control']).toBe('no-store');
  });

  it('does not authenticate when the active-session pointer is missing', async () => {
    const agent = request.agent(app);
    await register(agent);
    const loggedIn = await login(agent);
    await redis.del(store.activeKey(loggedIn.body.data.id));
    await agent.get('/api/v1/auth/me').expect(401);
    // The invalid cookie is cleared, so the same browser can establish a new session.
    await login(agent);
    await agent.get('/api/v1/auth/me').expect(200);
  });

  it('disconnects an idle socket when its session expires without another client event', async () => {
    const agent = request.agent(app);
    await register(agent);
    const loggedIn = await login(agent);
    const userId = loggedIn.body.data.id as string;
    const sid = (await redis.get(store.activeKey(userId)))!;
    const data = (await sessions.readSession(sid))!;
    data.cookie.expires = new Date(Date.now() + 500);
    await redis.set(store.sessionPrefix + sid, JSON.stringify(data), {
      PX: 500,
    });
    await redis.pExpire(store.activeKey(userId), 500);
    const socket = await socketFor(cookie(loggedIn));
    await new Promise<void>((resolve) =>
      socket.once('disconnect', () => resolve()),
    );
    expect(socket.connected).toBe(false);
  });

  it('disconnects sockets on logout', async () => {
    const agent = request.agent(app);
    await register(agent);
    const loggedIn = await login(agent);
    const socket = await socketFor(cookie(loggedIn));
    const disconnected = new Promise<void>((resolve) =>
      socket.once('disconnect', () => resolve()),
    );
    await agent.post('/api/v1/auth/logout').set('Origin', origin).expect(204);
    await disconnected;
    expect(socket.connected).toBe(false);
  });
});
