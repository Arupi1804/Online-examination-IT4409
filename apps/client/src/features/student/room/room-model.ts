import { z } from 'zod';

export const roomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(
    /^[A-HJ-NP-Z2-9]{6}$/,
    'Mã phòng gồm 6 ký tự A–Z và 2–9, không dùng I hoặc O.',
  );

const timestamp = z.string().datetime({ offset: true });
const examStatus = z.enum(['DRAFT', 'SCHEDULED', 'RUNNING', 'ENDED']);

// REST: docs/openapi.yaml on origin/dev. Realtime: #3's feature/realtime
// contract, pending merge. These client parsers do not change the shared contract.
export const examJoinInfoSchema = z.object({
  examId: z.string().uuid(),
  title: z.string().min(1),
  status: z.enum(['SCHEDULED', 'RUNNING']),
  durationSec: z.number().int().positive(),
  questionCount: z.number().int().nonnegative(),
  startTime: timestamp.nullable(),
  endTime: timestamp.nullable(),
  serverTime: timestamp,
  maxAttempts: z.number().int().positive(),
  attemptsUsed: z.number().int().nonnegative(),
  activeAttemptId: z.string().uuid().nullable(),
});

export const examClockSchema = z.object({
  examId: z.string().uuid(),
  status: examStatus,
  startTime: timestamp.nullable(),
  endTime: timestamp.nullable(),
  serverTime: timestamp,
});

export const roomStateSchema = examClockSchema.extend({
  roomCode: roomCodeSchema,
  participantCount: z.number().int().nonnegative(),
});

export type ExamJoinInfo = z.infer<typeof examJoinInfoSchema>;
export type ExamClock = z.infer<typeof examClockSchema>;
export type RoomState = z.infer<typeof roomStateSchema>;
export type JoinedRoom = ExamJoinInfo & { roomCode: string };
export type RoomConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'failed';

export interface RoomCallbacks {
  onState(state: RoomState): void;
  onClock(clock: ExamClock): void;
  onConnection(status: RoomConnectionStatus): void;
  onError(error: unknown): void;
}

export interface RoomService {
  lookup(code: string): Promise<JoinedRoom>;
  connect(room: JoinedRoom, callbacks: RoomCallbacks): () => void;
}

// A delayed ACK must not roll back a newer start/end event.
export function latestClock(
  current: ExamClock | null,
  incoming: ExamClock,
): ExamClock {
  if (!current) return incoming;
  if (incoming.examId !== current.examId) return current;
  const order = { DRAFT: 0, SCHEDULED: 1, RUNNING: 2, ENDED: 3 };
  if (order[incoming.status] < order[current.status]) return current;
  return Date.parse(incoming.serverTime) >= Date.parse(current.serverTime)
    ? incoming
    : current;
}
