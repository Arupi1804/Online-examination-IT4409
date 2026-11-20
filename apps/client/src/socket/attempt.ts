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
  recoveredAttemptSchema,
  isoTime,
  remainingSeconds,
  type AttemptPaper,
  type ExamCallbacks,
  type ClockSample,
  type ProctorEvent,
} from '../features/student/take-exam/exam-model.ts';

const ackSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: roomStateSchema }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string() }) }),
]);
const recoveredAck = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: recoveredAttemptSchema }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string() }) }),
]);
const heartbeatAck = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.object({ serverTime: isoTime }) }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string() }) }),
]);
const violationAck = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.object({ at: isoTime }) }),
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
  let joined = false;
  let recovering = false;
  let heartbeatPending = false;
  let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
  let lastClock: ClockSample | null = null;
  function stopHeartbeat() {
    clearInterval(heartbeatTimer);
    heartbeatTimer = undefined;
  }
  function businessError(code: string) {
    const error = new RoomError(code);
    if (['UNAUTHENTICATED', 'SESSION_REPLACED', 'FORBIDDEN'].includes(code))
      fail(error);
    else callbacks.onError(error);
  }
  function fail(error: unknown) {
    if (!active) return;
    active = false;
    joined = false;
    stopHeartbeat();
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
    const clock: ClockSample = {
      ...parsed.data,
      status: parsed.data.status as 'RUNNING' | 'ENDED',
      endTime: parsed.data.endTime,
      receivedAt: performance.now(),
      roundTripMs,
    };
    if (
      lastClock &&
      (Date.parse(clock.serverTime) < Date.parse(lastClock.serverTime) ||
        (lastClock.status === 'ENDED' && clock.status !== 'ENDED'))
    )
      return;
    lastClock = clock;
    if (clock.status === 'ENDED') stopHeartbeat();
    callbacks.onClock(clock);
  }
  function recover(requestGeneration: number) {
    if (!active || !socket.connected || recovering) return;
    recovering = true;
    joined = false;
    callbacks.onConnection(false);
    const sentAt = performance.now();
    socket
      .timeout(8000)
      .emit(
        'attempt:rejoin',
        { attemptId: paper.attemptId },
        (error: Error | null, response: unknown) => {
          if (!active || generation !== requestGeneration) return;
          recovering = false;
          if (error) {
            fail(new ExamError('REALTIME_TIMEOUT'));
            return;
          }
          const parsed = recoveredAck.safeParse(response);
          if (!parsed.success) {
            fail(parsed.error);
            return;
          }
          if (!parsed.data.ok) {
            fail(new RoomError(parsed.data.error.code));
            return;
          }
          const state = parsed.data.data;
          if (
            state.examId !== paper.examId ||
            state.attemptId !== paper.attemptId
          ) {
            fail(new ExamError('RESPONSE_MISMATCH'));
            return;
          }
          acceptClock(state.clock, performance.now() - sentAt);
          if (state.status !== 'IN_PROGRESS') {
            callbacks.onSubmitted(submissionSchema.parse(state));
            return;
          }
          try {
            callbacks.onRecovered(state);
          } catch (caught) {
            fail(caught);
            return;
          }
          if (!active) return;
          joined = true;
          callbacks.onConnection(true);
          stopHeartbeat();
          heartbeat();
          heartbeatTimer = setInterval(heartbeat, 10000);
        },
      );
  }
  function heartbeat() {
    if (
      !active ||
      !joined ||
      !socket.connected ||
      heartbeatPending ||
      !lastClock ||
      lastClock.status !== 'RUNNING' ||
      remainingSeconds(lastClock) === 0
    )
      return;
    heartbeatPending = true;
    const requestGeneration = generation;
    const sentAt = performance.now();
    socket.volatile
      .timeout(8000)
      .emit(
        'proctor:heartbeat',
        { attemptId: paper.attemptId },
        (error: Error | null, response: unknown) => {
          if (!active || generation !== requestGeneration) return;
          heartbeatPending = false;
          if (error) {
            callbacks.onConnection(false);
            callbacks.onError(new ExamError('REALTIME_TIMEOUT'));
            recover(requestGeneration);
            return;
          }
          const parsed = heartbeatAck.safeParse(response);
          if (!parsed.success) {
            fail(parsed.error);
            return;
          }
          if (!parsed.data.ok) {
            if (parsed.data.error.code === 'INVALID_STATE')
              recover(requestGeneration);
            else businessError(parsed.data.error.code);
            return;
          }
          if (lastClock)
            acceptClock(
              {
                ...lastClock,
                startTime: paper.startedAt,
                serverTime: parsed.data.data.serverTime,
              },
              performance.now() - sentAt,
            );
        },
      );
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
          recover(requestGeneration);
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
    joined = false;
    recovering = false;
    heartbeatPending = false;
    stopHeartbeat();
    if (active) callbacks.onConnection(false);
  });
  // React StrictMode mounts and cleans up effects once before the real mount.
  // Starting in the next microtask avoids abandoned Engine.IO handshakes.
  queueMicrotask(() => {
    if (active) socket.connect();
  });
  return {
    disconnect() {
      active = false;
      joined = false;
      stopHeartbeat();
      socket.removeAllListeners();
      socket.disconnect();
    },
    report(type: ProctorEvent, clientAt: string): Promise<void> {
      if (
        !active ||
        !joined ||
        !socket.connected ||
        !lastClock ||
        lastClock.status !== 'RUNNING' ||
        remainingSeconds(lastClock) === 0
      )
        return Promise.reject(new ExamError('REALTIME_DISCONNECTED'));
      z.enum(['TAB_BLUR', 'FULLSCREEN_EXIT']).parse(type);
      isoTime.parse(clientAt);
      const requestGeneration = generation;
      return new Promise((resolve, reject) => {
        socket
          .timeout(8000)
          .emit(
            'proctor:violation',
            { attemptId: paper.attemptId, type, clientAt },
            (error: Error | null, response: unknown) => {
              if (!active || generation !== requestGeneration || error) {
                reject(new ExamError('REALTIME_DISCONNECTED'));
                return;
              }
              const parsed = violationAck.safeParse(response);
              if (!parsed.success) {
                reject(parsed.error);
                return;
              }
              if (!parsed.data.ok) {
                businessError(parsed.data.error.code);
                reject(new RoomError(parsed.data.error.code));
                return;
              }
              resolve();
            },
          );
      });
    },
  };
}
