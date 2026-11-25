import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import { createApiRoomService } from '../src/features/student/room/api-room-service.ts';
import {
  getRoomErrorMessage,
  isRoomAuthError,
  RoomError,
} from '../src/features/student/room/room-errors.ts';
import {
  examJoinInfoSchema,
  latestClock,
  roomCodeSchema,
  roomStateSchema,
  type ExamClock,
} from '../src/features/student/room/room-model.ts';
import {
  forgetRoom,
  readRoomCode,
  saveRoom,
} from '../src/features/student/room/room-storage.ts';
import { ApiError } from '../src/services/api.ts';

afterEach(() => vi.unstubAllGlobals());

const info = {
  examId: 'c9ec68a2-0000-4000-8000-000000000001',
  title: 'Bài kiểm tra',
  status: 'SCHEDULED' as const,
  durationSec: 2700,
  questionCount: 30,
  startTime: null,
  endTime: null,
  serverTime: '2026-11-19T08:00:00.000Z',
  maxAttempts: 1,
  attemptsUsed: 0,
  activeAttemptId: null,
};

test('room codes normalize case and outer whitespace without repairing invalid characters', () => {
  assert.equal(roomCodeSchema.parse(' k7m2qx '), 'K7M2QX');
  for (const code of [
    '',
    'K7M2Q',
    'K7M2QXX',
    'K7M2QI',
    'K7M2QO',
    'K7M2Q0',
    'K7M2Q1',
    'K7 M2QX',
    '<K7M2>',
  ]) {
    assert.equal(roomCodeSchema.safeParse(code).success, false, code);
  }
});

test('lookup sends only the normalized roomCode with cookie credentials and parses ExamJoinInfo', async () => {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string, options: RequestInit) => {
    calls.push(url);
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'include');
    assert.deepEqual(JSON.parse(options.body as string), {
      roomCode: 'K7M2QX',
    });
    return Response.json({ data: info });
  });
  assert.deepEqual(await createApiRoomService().lookup(' k7m2qx '), {
    ...info,
    roomCode: 'K7M2QX',
  });
  assert.deepEqual(calls, ['/api/v1/exams/join']);
});

test('invalid codes never reach the API and incomplete responses never enter a waiting room', async () => {
  const fetch = vi.fn(async () =>
    Response.json({ data: { examId: info.examId } }),
  );
  vi.stubGlobal('fetch', fetch);
  await assert.rejects(createApiRoomService().lookup('invalid'));
  assert.equal(fetch.mock.calls.length, 0);
  await assert.rejects(createApiRoomService().lookup('K7M2QX'));
  assert.equal(fetch.mock.calls.length, 1);
  assert.equal(
    examJoinInfoSchema.safeParse({ ...info, status: 'ENDED' }).success,
    false,
  );
  assert.equal(
    roomStateSchema.safeParse({
      ...info,
      roomCode: 'K7M2QX',
      participantCount: -1,
    }).success,
    false,
  );
});

test('lookup preserves business errors and room messages never use the auth email-conflict fallback', async () => {
  vi.stubGlobal('fetch', async () =>
    Response.json(
      { error: { code: 'EXAM_ENDED', message: 'Ended' } },
      { status: 422 },
    ),
  );
  await assert.rejects(
    createApiRoomService().lookup('K7M2QX'),
    (error: unknown) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, 'EXAM_ENDED');
      assert.match(getRoomErrorMessage(error), /đã kết thúc/);
      return true;
    },
  );
  assert.match(getRoomErrorMessage(new ApiError(404, '')), /Không tìm thấy/);
  assert.match(getRoomErrorMessage(new ApiError(429, '')), /quá nhiều lần/);
  assert.doesNotMatch(getRoomErrorMessage(new ApiError(409, '')), /Email/);
  assert.equal(isRoomAuthError(new RoomError('SESSION_REPLACED')), true);
  assert.equal(isRoomAuthError(new ApiError(401, '')), true);
  assert.equal(isRoomAuthError(new RoomError('FORBIDDEN')), false);
});

test('saved room keys are scoped to account and exam and contain no cached authorization or status', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
  };
  saveRoom('student-a', { ...info, roomCode: 'K7M2QX' }, storage);
  assert.equal(readRoomCode('student-a', info.examId, storage), 'K7M2QX');
  assert.equal(readRoomCode('student-b', info.examId, storage), null);
  assert.equal(readRoomCode('student-a', 'other-exam', storage), null);
  assert.deepEqual(JSON.parse([...values.values()][0]!), {
    examId: info.examId,
    roomCode: 'K7M2QX',
  });
  storage.setItem([...values.keys()][0]!, '{bad json');
  assert.equal(readRoomCode('student-a', info.examId, storage), null);
  saveRoom('student-a', { ...info, roomCode: 'K7M2QX' }, storage);
  forgetRoom('student-a', storage);
  assert.equal(readRoomCode('student-a', info.examId, storage), null);
});

test('blocked browser storage does not prevent the current join navigation', () => {
  const blocked = () => {
    throw new Error('Storage blocked');
  };
  const storage = { getItem: blocked, setItem: blocked, removeItem: blocked };
  assert.doesNotThrow(() =>
    saveRoom('student', { ...info, roomCode: 'K7M2QX' }, storage),
  );
  assert.equal(readRoomCode('student', info.examId, storage), null);
  assert.doesNotThrow(() => forgetRoom('student', storage));
  // Access to the browser property itself can throw before a method is called.
  vi.stubGlobal('sessionStorage', undefined);
  assert.doesNotThrow(() =>
    saveRoom('student', { ...info, roomCode: 'K7M2QX' }),
  );
  assert.equal(readRoomCode('student', info.examId), null);
});

test('late snapshots cannot roll back a started or ended exam or replace a newer server clock', () => {
  const scheduled: ExamClock = { ...info };
  const running: ExamClock = {
    ...scheduled,
    status: 'RUNNING',
    serverTime: '2026-11-19T08:01:00.000Z',
  };
  const ended: ExamClock = {
    ...running,
    status: 'ENDED',
    serverTime: '2026-11-19T08:02:00.000Z',
  };
  assert.deepEqual(latestClock(null, scheduled), scheduled);
  assert.deepEqual(latestClock(scheduled, running), running);
  assert.deepEqual(latestClock(running, scheduled), running);
  assert.deepEqual(latestClock(ended, running), ended);
  assert.deepEqual(
    latestClock(running, {
      ...scheduled,
      serverTime: '2026-11-19T09:00:00.000Z',
    }),
    running,
  );
  assert.deepEqual(
    latestClock(running, { ...ended, examId: 'other' }),
    running,
  );
});
