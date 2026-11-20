import { io } from 'socket.io-client';
import { z } from 'zod';
import {
  examClockSchema,
  roomStateSchema,
} from '../features/student/room/room-model.ts';
import { RoomError } from '../features/student/room/room-errors.ts';
import { ExamError } from '../features/student/take-exam/exam-errors.ts';
import {
  submissionSchema,
  type AttemptPaper,
  type ExamCallbacks,
} from '../features/student/take-exam/exam-model.ts';

const ackSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: roomStateSchema }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string() }) }),
]);

export function connectAttempt(paper: AttemptPaper, callbacks: ExamCallbacks) {
  const socket = io(
    import.meta.env.VITE_REALTIME_URL ||
      import.meta.env.VITE_API_URL ||
      undefined,
    {
      autoConnect: false,
      withCredentials: true,
      forceNew: true,
      timeout: 8000,
      reconnectionDelayMax: 5000,
    },
  );
  let active = true;
  let generation = 0;
  function fail(error: unknown) {
    if (!active) return;
    active = false;
    callbacks.onConnection(false);
    callbacks.onError(error);
    socket.disconnect();
  }
  function acceptClock(payload: unknown, roundTripMs = 0) {
    if (!active) return;
    const parsed = examClockSchema.safeParse(payload);
    if (
      !parsed.success ||
      parsed.data.examId !== paper.examId ||
      !parsed.data.endTime ||
      !['RUNNING', 'ENDED'].includes(parsed.data.status)
    )
      return;
    callbacks.onClock({
      ...parsed.data,
      status: parsed.data.status as 'RUNNING' | 'ENDED',
      endTime: parsed.data.endTime,
      receivedAt: performance.now(),
      roundTripMs,
    });
  }
  socket.on('connect', () => {
    const requestGeneration = ++generation;
    const sentAt = performance.now();
    socket
      .timeout(8000)
      .emit(
        'room:join',
        { examId: paper.examId },
        (error: Error | null, response: unknown) => {
          if (!active || generation !== requestGeneration) return;
          if (error) {
            fail(new ExamError('REALTIME_TIMEOUT'));
            return;
          }
          const parsed = ackSchema.safeParse(response);
          if (!parsed.success) {
            fail(parsed.error);
            return;
          }
          if (!parsed.data.ok) {
            fail(new RoomError(parsed.data.error.code));
            return;
          }
          if (parsed.data.data.examId !== paper.examId) {
            fail(new ExamError('RESPONSE_MISMATCH'));
            return;
          }
          acceptClock(parsed.data.data, performance.now() - sentAt);
          callbacks.onConnection(true);
        },
      );
  });
  for (const event of ['timer:sync', 'exam:extended', 'exam:ended'])
    socket.on(event, (payload: unknown) => acceptClock(payload));
  socket.on('attempt:submitted', (payload: unknown) => {
    if (!active) return;
    const parsed = submissionSchema.safeParse(payload);
    if (
      parsed.success &&
      parsed.data.attemptId === paper.attemptId &&
      parsed.data.examId === paper.examId
    )
      callbacks.onSubmitted(parsed.data);
  });
  socket.on('session:replaced', () => fail(new RoomError('SESSION_REPLACED')));
  socket.on('connect_error', (error: Error & { data?: { code?: string } }) => {
    if (!active) return;
    if (error.data?.code) fail(new RoomError(error.data.code));
    else {
      callbacks.onConnection(false);
      if (!socket.active) callbacks.onError(error);
    }
  });
  socket.on('disconnect', () => {
    generation += 1;
    if (active) callbacks.onConnection(false);
  });
  // React StrictMode mounts and cleans up effects once before the real mount.
  // Starting in the next microtask avoids abandoned Engine.IO handshakes.
  queueMicrotask(() => {
    if (active) socket.connect();
  });
  return () => {
    active = false;
    socket.removeAllListeners();
    socket.disconnect();
  };
}
