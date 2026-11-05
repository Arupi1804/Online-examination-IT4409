import { createHmac } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import type { NextFunction } from 'express';
import { PrismaClient } from '@prisma/client';
import { createClient } from 'redis';
import { Server } from 'socket.io';
import { z } from 'zod';
import { WS_NAMESPACE } from '@online-exam/shared';
import { createApp } from './app.js';
import {
  AuthSessions,
  AuthSessionStore,
  createAuthRouter,
  PrismaAuthRepository,
} from './modules/auth/index.js';

config({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });
const env = z
  .object({
    SERVER_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
    SESSION_SECRET: z.string().min(32),
    APP_ENV: z.enum(['dev', 'staging', 'prod']).default('dev'),
    COOKIE_SECURE: z.enum(['true', 'false']).default('false'),
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(1).default(0),
    DATABASE_URL: z.string().url(),
    REDIS_URL: z.string().url(),
  })
  .safeParse(process.env);
if (!env.success) {
  console.error(
    'Invalid server configuration:',
    env.error.issues.map((issue) => issue.path.join('.')).join(', '),
  );
  process.exit(1);
}
const settings = env.data;
if (settings.APP_ENV !== 'dev' && settings.COOKIE_SECURE !== 'true') {
  console.error('Staging/production requires COOKIE_SECURE=true and HTTPS');
  process.exit(1);
}
const prisma = new PrismaClient({
  datasources: { db: { url: settings.DATABASE_URL } },
});
const redis = createClient({
  url: settings.REDIS_URL,
  socket: {
    connectTimeout: 5000,
    reconnectStrategy: (retries) =>
      retries < 3 ? 200 : new Error('Redis unavailable'),
  },
});
redis.on('error', () => console.error('Redis connection unavailable'));
let io: Server | undefined;
let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (io) await new Promise<void>((resolve) => io!.close(() => resolve()));
  await prisma.$disconnect();
  if (redis.isOpen) await redis.quit();
}
try {
  await Promise.all([prisma.$connect(), redis.connect()]);
  const sessions = new AuthSessions({
    store: new AuthSessionStore(redis, `oe:${settings.APP_ENV}:v1`),
    secret: settings.SESSION_SECRET,
    clientOrigin: settings.CLIENT_ORIGIN,
    secureCookie: settings.COOKIE_SECURE === 'true',
  });
  const authRouter = await createAuthRouter({
    sessions,
    repository: new PrismaAuthRepository(prisma),
    rateLimitSecret: createHmac('sha256', settings.SESSION_SECRET)
      .update('oe-auth-rate-limit-v1')
      .digest('hex'),
  });
  const server = createServer(
    createApp(settings.CLIENT_ORIGIN, {
      authRouter,
      trustProxyHops: settings.TRUST_PROXY_HOPS,
    }),
  );
  io = new Server(server, {
    cors: { origin: settings.CLIENT_ORIGIN, credentials: true },
  });
  io.engine.use(
    (req: IncomingMessage, res: ServerResponse, next: NextFunction) => {
      if ((req as typeof req & { _query?: { sid?: string } })._query?.sid) {
        next();
        return;
      }
      sessions.socketSessionMiddleware(
        req as Parameters<typeof sessions.socketSessionMiddleware>[0],
        res as Parameters<typeof sessions.socketSessionMiddleware>[1],
        next,
      );
    },
  );
  sessions.attachSocketAuthentication(io.of(WS_NAMESPACE));
  server.on('error', () => {
    console.error('HTTP server could not start');
    void shutdown().finally(() => {
      process.exitCode = 1;
    });
  });
  server.listen(settings.SERVER_PORT, '0.0.0.0', () =>
    console.log(`API listening on ${settings.SERVER_PORT}`),
  );
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.once(signal, () => {
      void shutdown();
    });
} catch {
  console.error(
    'Auth bootstrap failed; check PostgreSQL, Redis and server configuration',
  );
  await shutdown();
  process.exitCode = 1;
}
