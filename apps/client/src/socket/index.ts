import { io } from 'socket.io-client';
import { z } from 'zod';
import { examSocketUrl } from './namespace.ts';
import { RoomError } from '../features/student/room/room-errors.ts';
import {
  examClockSchema,
  roomStateSchema,
  type JoinedRoom,
  type RoomCallbacks,
} from '../features/student/room/room-model.ts';

const ackSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: roomStateSchema }),
  z.object({
    ok: z.literal(false),
    error: z.object({ code: z.string(), message: z.string() }),
  }),
]);
const participantSchema = z.object({
  examId: z.string().uuid(),
  userId: z.string().uuid(),
  role: z.enum(['STUDENT', 'TEACHER', 'ADMIN']),
});

export function connectRoom(
  room: JoinedRoom,
  callbacks: RoomCallbacks,
): () => void {
  const socket = io(
    examSocketUrl(
      import.meta.env.VITE_REALTIME_URL ||
        import.meta.env.VITE_API_URL ||
        undefined,
    ),
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
  let refreshing = false;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let lastJoinAt = 0;

  function fail(error: unknown) {
    if (!active) return;
    active = false;
    clearTimeout(refreshTimer);
    callbacks.onConnection('failed');
    callbacks.onError(error);
    socket.disconnect();
  }
  function acceptState(payload: unknown) {
    if (!active) return;
    const parsed = roomStateSchema.safeParse(payload);
    if (!parsed.success) {
      fail(parsed.error);
      return;
    }
    if (
      parsed.data.examId !== room.examId ||
      parsed.data.roomCode !== room.roomCode
    ) {
      fail(new RoomError('ROOM_MISMATCH'));
      return;
    }
    if (parsed.data.status === 'DRAFT') {
      fail(new RoomError('INVALID_STATE'));
      return;
    }
    callbacks.onState(parsed.data);
  }
  function join() {
    if (!active || !socket.connected || refreshing) return;
    refreshing = true;
    lastJoinAt = Date.now();
    const requestGeneration = generation;
    socket
      .timeout(8000)
      .emit(
        'room:join',
        { roomCode: room.roomCode },
        (error: Error | null, response: unknown) => {
          if (!active || requestGeneration !== generation) return;
          refreshing = false;
          if (error) {
            fail(new RoomError('ROOM_TIMEOUT'));
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
          acceptState(parsed.data.data);
        },
      );
  }
  function refreshParticipants(payload: unknown) {
    const parsed = participantSchema.safeParse(payload);
    if (!active || !parsed.success || parsed.data.examId !== room.examId)
      return;
    // Read the authoritative socket count; userId does not identify a socket.
    // Stay below the gateway's limit of 20 room joins per minute.
    if (refreshTimer) return;
    refreshTimer = setTimeout(
      () => {
        refreshTimer = undefined;
        if (refreshing) refreshParticipants(payload);
        else join();
      },
      Math.max(350, 5000 - (Date.now() - lastJoinAt)),
    );
  }
  function acceptClock(payload: unknown) {
    if (!active) return;
    const parsed = examClockSchema.safeParse(payload);
    if (parsed.success && parsed.data.examId === room.examId)
      callbacks.onClock(parsed.data);
  }
  socket.on('connect', () => {
    if (!active) return;
    generation += 1;
    refreshing = false;
    callbacks.onConnection('connecting');
    join();
  });
  socket.on('room:state', acceptState);
  socket.on('participant:joined', refreshParticipants);
  socket.on('participant:left', refreshParticipants);
  for (const event of ['exam:started', 'exam:ended', 'timer:sync'])
    socket.on(event, acceptClock);
  socket.on('session:replaced', () => fail(new RoomError('SESSION_REPLACED')));
  socket.on('disconnect', (reason) => {
    if (!active) return;
    generation += 1;
    refreshing = false;
    clearTimeout(refreshTimer);
    refreshTimer = undefined;
    if (reason === 'io server disconnect')
      fail(new RoomError('ROOM_DISCONNECTED'));
    else callbacks.onConnection('reconnecting');
  });
  socket.on('connect_error', (error: Error & { data?: { code?: string } }) => {
    if (!active) return;
    if (error.data?.code) fail(new RoomError(error.data.code));
    else if (!socket.active) fail(new RoomError('ROOM_DISCONNECTED'));
    else callbacks.onConnection('reconnecting');
  });
  callbacks.onConnection('connecting');
  socket.connect();
  return () => {
    active = false;
    clearTimeout(refreshTimer);
    socket.removeAllListeners();
    socket.disconnect();
  };
}
