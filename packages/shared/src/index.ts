import { z } from 'zod';

export const Role = z.enum(['ADMIN', 'TEACHER', 'STUDENT']);
export type Role = z.infer<typeof Role>;
export const QuestionType = z.enum(['SINGLE', 'MULTIPLE', 'TRUE_FALSE']);
export const ExamStatus = z.enum(['DRAFT', 'SCHEDULED', 'RUNNING', 'ENDED']);
export const AttemptStatus = z.enum([
  'IN_PROGRESS',
  'SUBMITTED',
  'AUTO_SUBMITTED',
  'FORCE_SUBMITTED',
]);
export const RoomCode = z.string().regex(/^[A-HJ-NP-Z2-9]{6}$/);
export const ViolationType = z.enum([
  'TAB_BLUR',
  'FULLSCREEN_EXIT',
  'COPY_PASTE',
  'DISCONNECT',
]);
export const ProctorViolationPayload = z.object({
  attemptId: z.string().uuid(),
  type: ViolationType,
  at: z.string().datetime(),
});
export type ProctorViolationPayload = z.infer<typeof ProctorViolationPayload>;
export const WS_NAMESPACE = '/exam';
export const WS = {
  ROOM_JOIN: 'room:join',
  ROOM_STATE: 'room:state',
  PARTICIPANT_JOINED: 'participant:joined',
  PARTICIPANT_LEFT: 'participant:left',
  EXAM_START: 'exam:start',
  EXAM_STARTED: 'exam:started',
  EXAM_EXTEND: 'exam:extend',
  EXAM_EXTENDED: 'exam:extended',
  EXAM_ENDED: 'exam:ended',
  TIMER_SYNC: 'timer:sync',
  ATTEMPT_REJOIN: 'attempt:rejoin',
  ATTEMPT_STATE: 'attempt:state',
  ATTEMPT_FORCE_SUBMIT: 'attempt:force_submit',
  ATTEMPT_SUBMITTED: 'attempt:submitted',
  PROCTOR_HEARTBEAT: 'proctor:heartbeat',
  PROCTOR_VIOLATION: 'proctor:violation',
  MONITOR_STUDENT_UPDATE: 'monitor:student_update',
  SESSION_REPLACED: 'session:replaced',
} as const;
export const ERROR_CODES = {
  AUTH_INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  AUTH_SESSION_EXPIRED: 'AUTH_SESSION_EXPIRED',
  AUTH_SESSION_REPLACED: 'AUTH_SESSION_REPLACED',
  FORBIDDEN: 'FORBIDDEN',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  EXAM_NOT_STARTED: 'EXAM_NOT_STARTED',
  EXAM_ENDED: 'EXAM_ENDED',
  ATTEMPT_ALREADY_SUBMITTED: 'ATTEMPT_ALREADY_SUBMITTED',
  ATTEMPT_LIMIT_REACHED: 'ATTEMPT_LIMIT_REACHED',
  SUBMIT_TOO_LATE: 'SUBMIT_TOO_LATE',
  NOT_FOUND: 'NOT_FOUND',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;
export interface ApiError {
  code: string;
  message: string;
  details?: { field: string; issue: string }[];
}
export interface ApiResponse<T> {
  data: T;
  meta?: { page: number; pageSize: number; total: number };
}
export type SocketAck<T> =
  | { ok: true; data: T }
  | { ok: false; error: ApiError };
