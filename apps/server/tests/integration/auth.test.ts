import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
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
        throw new AuthError(
          409,
          'AUTH_EMAIL_TAKEN',
          'Email is already registered',
        );
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
      passwords: bcryptPasswords(4),
    });
    app = createApp(origin, { authRouter });
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

  async function csrf(agent: Agent) {
    const response = await agent.get('/api/v1/auth/csrf').expect(200);
    return response.body.data.csrfToken as string;
  }
  async function register(agent: Agent, email = 'student@example.test') {
    const token = await csrf(agent);
    return agent
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .set('X-CSRF-Token', token)
      .send({ email, name: 'Student', password })
      .expect(201);
  }
  async function login(agent: Agent, email = 'student@example.test') {
    const token = await csrf(agent);
    return agent
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .set('X-CSRF-Token', token)
      .send({ email, password })
      .expect(200);
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
    const token = await csrf(agent);
    const denied = await agent
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .set('X-CSRF-Token', token)
      .send({
        email: 'admin@example.test',
        name: 'Admin',
        password,
        role: 'ADMIN',
      })
      .expect(400);
    expect(denied.body.error.code).toBe('VALIDATION_FAILED');
    const created = await register(agent, ' Student@Example.Test ');
    expect(created.body.data.user).toMatchObject({
      email: 'student@example.test',
      role: 'STUDENT',
    });
    expect(created.body.data.user).not.toHaveProperty('passwordHash');
    expect(users.get('student@example.test')!.passwordHash).not.toBe(password);
    const duplicate = await agent
      .post('/api/v1/auth/register')
      .set('Origin', origin)
      .set('X-CSRF-Token', await csrf(agent))
      .send({ email: 'student@example.test', name: 'Again', password })
      .expect(409);
    expect(duplicate.body.error.code).toBe('AUTH_EMAIL_TAKEN');
  });

  it('requires Origin/CSRF, rotates the session and token on login, and logs out', async () => {
    const agent = request.agent(app);
    const csrfResponse = await agent.get('/api/v1/auth/csrf').expect(200);
    const beforeCookie = cookie(csrfResponse);
    await agent
      .post('/api/v1/auth/login')
      .send({ email: 'student@example.test', password })
      .expect(403);
    await agent
      .post('/api/v1/auth/login')
      .set('Origin', 'https://evil.example')
      .set('X-CSRF-Token', csrfResponse.body.data.csrfToken)
      .send({ email: 'student@example.test', password })
      .expect(403);
    await register(agent);
    const loggedIn = await login(agent);
    expect(cookie(loggedIn)).not.toBe(beforeCookie);
    expect(loggedIn.headers['set-cookie'].join(';')).toContain('HttpOnly');
    expect(loggedIn.headers['set-cookie'].join(';')).toContain('SameSite=Lax');
    expect(loggedIn.body.data.csrfToken).not.toBe(
      csrfResponse.body.data.csrfToken,
    );
    await agent.get('/api/v1/auth/me').expect(200);
    await agent
      .post('/api/v1/auth/logout')
      .set('Origin', origin)
      .set('X-CSRF-Token', loggedIn.body.data.csrfToken)
      .expect(204);
    await agent.get('/api/v1/auth/me').expect(401);
  });

  it('replaces the old session, disconnects its socket and prevents stale saves/deletes', async () => {
    const first = request.agent(app);
    const second = request.agent(app);
    await register(first);
    const loginA = await login(first);
    const id = loginA.body.data.user.id as string;
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
    const userId = loggedIn.body.data.user.id as string;
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
    const sid = (await redis.get(store.activeKey(loggedIn.body.data.user.id)))!;
    await redis.del(store.sessionPrefix + sid);
    await agent.get('/api/v1/auth/me').expect(401);
    await expect(socketFor(cookie(loggedIn))).rejects.toMatchObject({
      data: { code: 'AUTH_SESSION_EXPIRED' },
    });
  });

  it('limits login attempts per normalized account', async () => {
    const agent = request.agent(app);
    const token = await csrf(agent);
    for (let i = 0; i < 5; i++) {
      const failed = await agent
        .post('/api/v1/auth/login')
        .set('Origin', origin)
        .set('X-CSRF-Token', token)
        .send({ email: 'missing@example.test', password })
        .expect(401);
      expect(failed.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
    }
    const blocked = await agent
      .post('/api/v1/auth/login')
      .set('Origin', origin)
      .set('X-CSRF-Token', token)
      .send({ email: ' MISSING@EXAMPLE.TEST ', password })
      .expect(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
    expect(blocked.headers['retry-after']).toBe('900');
  });

  it('does not authenticate when the active-session pointer is missing', async () => {
    const agent = request.agent(app);
    await register(agent);
    const loggedIn = await login(agent);
    await redis.del(store.activeKey(loggedIn.body.data.user.id));
    await agent.get('/api/v1/auth/me').expect(401);
    // The invalid cookie is cleared, so the same browser can establish a new session.
    await login(agent);
    await agent.get('/api/v1/auth/me').expect(200);
  });

  it('disconnects an idle socket when its session expires without another client event', async () => {
    const agent = request.agent(app);
    await register(agent);
    const loggedIn = await login(agent);
    const userId = loggedIn.body.data.user.id as string;
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
    await agent
      .post('/api/v1/auth/logout')
      .set('Origin', origin)
      .set('X-CSRF-Token', loggedIn.body.data.csrfToken)
      .expect(204);
    await disconnected;
    expect(socket.connected).toBe(false);
  });
});
