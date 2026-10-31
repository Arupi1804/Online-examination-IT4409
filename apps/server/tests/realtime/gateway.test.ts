/* KIỂM THỬ TÍCH HỢP SOCKET.IO GATEWAY (NODE TEST RUNNER) */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { afterEach, test } from 'node:test';
import type { RequestHandler } from 'express';
import { Store } from 'express-session';
import { io as clientIo, type Socket as ClientSocket } from 'socket.io-client';
import { createRealtimeGateway } from '../../src/modules/realtime/handlers/gateway.js';
import { RealtimeError } from '../../src/modules/realtime/errors.js';
import type { RealtimeService } from '../../src/modules/realtime/services/service.js';

// Store giả lập thay Redis session, đủ 3 method get/set/destroy cho bài test
class MemoryStore extends Store {
  sessions = new Map<string, { userId: string; role: string }>();
  override get(
    sid: string,
    callback: (err: unknown, session?: never) => void,
  ): void {
    callback(null, this.sessions.get(sid) as never);
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
  store.sessions.set('teacher', {
    userId: '11111111-1111-4111-8111-111111111111',
    role: 'TEACHER',
  });
  store.sessions.set('student', {
    userId: '22222222-2222-4222-8222-222222222222',
    role: 'STUDENT',
  });
  const active = new Map<string, string>([
    ['11111111-1111-4111-8111-111111111111', 'teacher'],
    ['22222222-2222-4222-8222-222222222222', 'student'],
  ]);
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
      assertActiveSession: async (userId: string, sid: string) => {
        if (active.get(userId) !== sid)
          throw new RealtimeError('SESSION_REPLACED', 'Session replaced');
      },
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
  const sessionMiddleware: RequestHandler = (req, _res, next) => {
    (req as typeof req & { sessionID: string }).sessionID =
      req.headers.cookie?.replace('sid=', '') ?? '';
    next();
  };
  const gateway = createRealtimeGateway({
    httpServer,
    sessionMiddleware,
    sessionStore: store,
    service,
    clientOrigin: 'http://localhost:5173',
  });
  await new Promise<void>((resolve) =>
    httpServer.listen(0, '127.0.0.1', resolve),
  );
  const address = httpServer.address();
  if (!address || typeof address === 'string') throw new Error('Missing port');
  const url = `http://127.0.0.1:${address.port}`;
  cleanup.push(async () => {
    await gateway.close();
    if (httpServer.listening)
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  });
  function connect(sid: string): ClientSocket {
    const socket = clientIo(url, {
      transports: ['websocket'],
      extraHeaders: { cookie: `sid=${sid}` },
      reconnection: false,
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
  const unknown = f.connect('missing');
  const error = await new Promise<Error & { data?: { code: string } }>(
    (resolve) => unknown.once('connect_error', resolve),
  );
  assert.equal(error.data?.code, 'UNAUTHENTICATED');
  f.active.set('22222222-2222-4222-8222-222222222222', 'new-session');
  const replaced = f.connect('student');
  const replacedError = await new Promise<Error & { data?: { code: string } }>(
    (resolve) => replaced.once('connect_error', resolve),
  );
  assert.equal(replacedError.data?.code, 'SESSION_REPLACED');
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
  assert.equal(refused.error.code, 'SESSION_REPLACED');
  assert.deepEqual(await replaced, { reason: 'SESSION_REPLACED' });
  assert.equal(f.calls.filter((x) => x === 'start').length, 1);
});
