/* KIỂM THỬ TÍCH HỢP SOCKET.IO GATEWAY (NODE TEST RUNNER) */

import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { afterEach, test } from 'node:test';
import type { NextFunction } from 'express';
import { Store, type SessionData } from 'express-session';
import { Server } from 'socket.io';
import { io as clientIo, type Socket as ClientSocket } from 'socket.io-client';
import { AUTH, WS_NAMESPACE } from '@online-exam/shared';
import { AuthSessions } from '../../src/modules/auth/session.js';
import type { AuthSessionStore } from '../../src/modules/auth/services/session-store.js';
import { createRealtimeGateway } from '../../src/modules/realtime/handlers/gateway.js';
import { RealtimeError } from '../../src/modules/realtime/errors.js';
import type { RealtimeService } from '../../src/modules/realtime/services/service.js';

// Store giả lập cho AuthSessions; gateway không tự đọc cookie hay session.
class MemoryStore extends Store {
  sessions = new Map<string, SessionData>();
  override get(
    sid: string,
    callback: (err: unknown, session?: SessionData | null) => void,
  ): void {
    callback(null, this.sessions.get(sid) ?? null);
  }
  override set(
    _sid: string,
    _session: never,
    callback?: (err?: unknown) => void,
  ): void {
    callback?.();
  }
  override destroy(_sid: string, callback?: (err?: unknown) => void): void {
    callback?.();
  }
}

const sockets: ClientSocket[] = [];
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.disconnect();
  for (const close of cleanup.splice(0)) await close();
});

// Tạo môi trường test độc lập, giả lập hai vai trò student/teacher
async function fixture() {
  const httpServer = createServer();
  const store = new MemoryStore();
  const secret = 'realtime-test-secret-with-at-least-32-characters';
  const expires = new Date(Date.now() + 3_600_000);
  store.sessions.set('teacher', {
    userId: '11111111-1111-4111-8111-111111111111',
    role: 'TEACHER',
    cookie: { expires },
  } as SessionData);
  store.sessions.set('student', {
    userId: '22222222-2222-4222-8222-222222222222',
    role: 'STUDENT',
    cookie: { expires },
  } as SessionData);
  const active = new Map<string, string>([
    ['11111111-1111-4111-8111-111111111111', 'teacher'],
    ['22222222-2222-4222-8222-222222222222', 'student'],
  ]);
  const authStore = Object.assign(store, {
    redis: {
      get: async (key: string) => {
        const userId = key.match(/:auth:user:([^:]+):active_session$/)?.[1];
        return userId ? (active.get(userId) ?? null) : null;
      },
    },
    activeKey: (userId: string) =>
      `oe:dev:v1:auth:user:${userId}:active_session`,
  }) as unknown as AuthSessionStore;
  const sessions = new AuthSessions({
    store: authStore,
    secret,
    clientOrigin: 'http://localhost:5173',
    secureCookie: false,
  });
  const calls: string[] = [];
  const examId = '33333333-3333-4333-8333-333333333333';
  const attemptId = '44444444-4444-4444-8444-444444444444';
  const clock = {
    examId,
    status: 'RUNNING' as const,
    startTime: '2026-01-01T00:00:00.000Z',
    endTime: '2026-01-01T01:00:00.000Z',
    serverTime: '2026-01-01T00:00:00.000Z',
  };
  const service = {
    cache: {
      rateLimit: async () => {},
      removePresence: async () => {},
    },
    join: async (_: unknown, principal: { role: string }) => {
      calls.push('join');
      return {
        state: { ...clock, roomCode: 'ABC234', participantCount: 0 },
        monitor: principal.role === 'TEACHER',
        attemptIds: [],
      };
    },
    start: async (_: unknown, principal: { role: string }) => {
      if (principal.role !== 'TEACHER')
        throw new RealtimeError('FORBIDDEN', 'Teacher required');
      calls.push('start');
      return clock;
    },
    extend: async () => clock,
    rejoin: async (_: unknown, principal: { role: string }) => {
      if (principal.role !== 'STUDENT')
        throw new RealtimeError('FORBIDDEN', 'Student required');
      return {
        attemptId,
        examId,
        status: 'IN_PROGRESS',
        submittedAt: null,
        answers: [],
        clock,
      };
    },
  } as unknown as RealtimeService;
  const io = new Server(httpServer);
  io.engine.use(
    (req: IncomingMessage, res: ServerResponse, next: NextFunction) =>
      sessions.socketSessionMiddleware(
        req as Parameters<typeof sessions.socketSessionMiddleware>[0],
        res as Parameters<typeof sessions.socketSessionMiddleware>[1],
        next,
      ),
  );
  const namespace = io.of(WS_NAMESPACE);
  const gateway = createRealtimeGateway({
    namespace,
    sessions,
    service,
  });
  await new Promise<void>((resolve) =>
    httpServer.listen(0, '127.0.0.1', resolve),
  );
  const address = httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Missing port');
  const url = `http://127.0.0.1:${address.port}`;
  cleanup.push(async () => {
    gateway.close();
    await new Promise<void>((resolve) => io.close(() => resolve()));
    if (httpServer.listening)
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });
  function connect(sid?: string): ClientSocket {
    const signature = sid
      ? createHmac('sha256', secret)
          .update(sid)
          .digest('base64')
          .replace(/=+$/, '')
      : undefined;
    const cookie = sid
      ? `${AUTH.COOKIE_NAME}=${encodeURIComponent(`s:${sid}.${signature}`)}`
      : undefined;
    const socket = clientIo(`${url}${WS_NAMESPACE}`, {
      transports: ['websocket'],
      extraHeaders: cookie ? { cookie } : {},
      reconnection: false,
      forceNew: true,
    });
    sockets.push(socket);
    return socket;
  }
  return { store, active, calls, gateway, connect, examId, attemptId };
}

// Promise hoàn thành khi socket connect hoặc reject nếu connect_error
function connected(socket: ClientSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
}

// Case 1: không có session hoặc session đã bị thay thế phải thất bại ngay handshake
test('handshake rejects missing or inactive session', async () => {
  const f = await fixture();
  const unknown = f.connect();
  const error = await new Promise<Error & { data?: { code: string } }>(
    (resolve) => unknown.once('connect_error', resolve),
  );
  assert.equal(error.data?.code, 'AUTH_SESSION_EXPIRED');
  f.active.set('22222222-2222-4222-8222-222222222222', 'new-session');
  const replaced = f.connect('student');
  const replacedError = await new Promise<Error & { data?: { code: string } }>(
    (resolve) => replaced.once('connect_error', resolve),
  );
  assert.equal(replacedError.data?.code, 'AUTH_SESSION_REPLACED');
});

// Case 2: join phòng, phân quyền start, nhận broadcast, rejoin và hủy phiên giữa kết nối
test('room join, role check, rejoin and live session revocation', async () => {
  const f = await fixture();
  const teacher = f.connect('teacher');
  const student = f.connect('student');
  await Promise.all([connected(teacher), connected(student)]);
  const joined = await teacher.emitWithAck('room:join', { examId: f.examId });
  assert.equal(joined.ok, true);
  const studentJoined = await student.emitWithAck('room:join', {
    examId: f.examId,
  });
  assert.equal(studentJoined.ok, true);
  const denied = await student.emitWithAck('exam:start', { examId: f.examId });
  assert.deepEqual(denied, {
    ok: false,
    error: { code: 'FORBIDDEN', message: 'Teacher required' },
  });
  const startedEvent = new Promise((resolve) =>
    student.once('exam:started', resolve),
  );
  const started = await teacher.emitWithAck('exam:start', { examId: f.examId });
  assert.equal(started.ok, true);
  assert.deepEqual(await startedEvent, started.data);
  const restored = await student.emitWithAck('attempt:rejoin', {
    attemptId: f.attemptId,
  });
  assert.equal(restored.data.attemptId, f.attemptId);
  f.active.set('22222222-2222-4222-8222-222222222222', 'new-session');
  const replaced = new Promise((resolve) =>
    student.once('session:replaced', resolve),
  );
  const refused = await student.emitWithAck('room:join', { examId: f.examId });
  assert.equal(refused.error.code, 'AUTH_SESSION_REPLACED');
  assert.deepEqual(await replaced, {});
  assert.equal(f.calls.filter((x) => x === 'start').length, 1);
});

test('timer sync ignores a stale deadline after an extension', async () => {
  const f = await fixture();
  const student = f.connect('student');
  await connected(student);
  const joined = await student.emitWithAck('room:join', { examId: f.examId });
  assert.equal(joined.ok, true);

  const received: string[] = [];
  student.on('timer:sync', (state: { endTime: string }) => {
    received.push(state.endTime);
  });
  const newer = {
    examId: f.examId,
    status: 'RUNNING' as const,
    startTime: '2026-01-01T00:00:00.000Z',
    endTime: '2026-01-01T01:30:00.000Z',
    serverTime: '2026-01-01T00:01:00.000Z',
  };
  const receivedNewer = new Promise<void>((resolve) =>
    student.once('timer:sync', () => resolve()),
  );
  f.gateway.emitTimerSync(newer);
  await receivedNewer;
  f.gateway.emitTimerSync({
    ...newer,
    endTime: '2026-01-01T01:00:00.000Z',
    serverTime: '2026-01-01T00:02:00.000Z',
  });
  const latest = { ...newer, endTime: '2026-01-01T02:00:00.000Z' };
  const receivedLatest = new Promise<void>((resolve) =>
    student.once('timer:sync', () => resolve()),
  );
  f.gateway.emitTimerSync(latest);
  await receivedLatest;
  assert.deepEqual(received, [newer.endTime, latest.endTime]);
});
