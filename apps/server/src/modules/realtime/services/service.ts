/* TẦNG NGHIỆP VỤ REALTIME (APPLICATION SERVICE) */

import type {
  AttemptState,
  ExamClock,
  RoomState,
  StudentUpdate,
  Submitted,
  ViolationType,
} from '../../../shared/realtime.js';
import {
  assertUuid,
  objectPayload,
  positiveInteger,
  RealtimeError,
} from '../errors.js';
import {
  clock,
  type Exam,
  type Principal,
  RealtimeRepository,
} from './repository.js';
import { RealtimeRedis } from './redis.js';

export type JoinResult = {
  state: RoomState;
  monitor: boolean;
  attemptIds: string[];
};

// Điểm phối hợp DB/Redis cho từng nghiệp vụ nhận từ Gateway
export class RealtimeService {
  constructor(
    readonly db: RealtimeRepository,
    readonly cache: RealtimeRedis,
    private readonly logger: Pick<Console, 'error'> = console,
  ) {}

  // Đồng bộ cache sau ghi DB; lỗi cache không làm mất commit ở PostgreSQL
  private async cacheAfterCommit(exam: Exam): Promise<void> {
    try {
      await this.cache.cacheRuntime(exam);
    } catch (error) {
      this.logger.error(
        'Runtime cache update failed; PostgreSQL remains authoritative',
        { examId: exam.id, error },
      );
    }
  }

  // Đọc payload roomCode/examId, kiểm tra quyền vào phòng và tạo RoomState
  async join(payload: unknown, principal: Principal): Promise<JoinResult> {
    const data = objectPayload(payload);
    const roomCode =
      typeof data.roomCode === 'string' &&
      /^[A-HJ-NP-Z2-9]{6}$/.test(data.roomCode)
        ? data.roomCode
        : undefined;
    const exam = roomCode
      ? await this.db.examByCode(roomCode)
      : await this.db.exam(assertUuid(data.examId, 'examId'));
    await this.db.canJoin(exam, principal, roomCode);
    const monitor = principal.role === 'ADMIN' || principal.role === 'TEACHER';
    const attemptIds = monitor ? await this.db.monitor(exam.id) : [];
    const updates = monitor
      ? await Promise.all(attemptIds.map((id) => this.studentUpdate(id)))
      : undefined;
    await this.cacheAfterCommit(exam);
    return {
      state: {
        ...clock(exam),
        roomCode: exam.room_code,
        participantCount: 0,
        ...(updates ? { monitor: updates } : {}),
      },
      monitor,
      attemptIds,
    };
  }

  // Validate examId rồi khởi động kỳ thi trong PostgreSQL trước khi cache
  async start(payload: unknown, principal: Principal): Promise<ExamClock> {
    const id = assertUuid(objectPayload(payload).examId, 'examId');
    const exam = await this.db.start(id, principal);
    await this.cacheAfterCommit(exam);
    return clock(exam);
  }

  // Gia hạn thời lượng tối đa 86400 giây theo hợp đồng Socket.IO
  async extend(payload: unknown, principal: Principal): Promise<ExamClock> {
    const data = objectPayload(payload);
    const id = assertUuid(data.examId, 'examId');
    const seconds = positiveInteger(data.additionalSec, 'additionalSec', 86400);
    const exam = await this.db.extend(id, seconds, principal);
    await this.cacheAfterCommit(exam);
    return clock(exam);
  }

  // Khôi phục bài làm chỉ sau khi Repository kiểm tra attempt thuộc user
  async rejoin(payload: unknown, principal: Principal): Promise<AttemptState> {
    return this.db.attemptState(
      assertUuid(objectPayload(payload).attemptId, 'attemptId'),
      principal,
    );
  }

  // Ủy quyền cho Repository chốt attempt của học sinh trong transaction
  async forceSubmit(
    payload: unknown,
    principal: Principal,
  ): Promise<Submitted | null> {
    return this.db.forceSubmit(
      assertUuid(objectPayload(payload).attemptId, 'attemptId'),
      principal,
    );
  }

  // Xác minh attempt đang thi rồi cập nhật heartbeat Redis
  async heartbeat(
    payload: unknown,
    principal: Principal,
  ): Promise<{ examId: string; attemptId: string; changed: boolean }> {
    const attemptId = assertUuid(objectPayload(payload).attemptId, 'attemptId');
    const attempt = await this.db.activeAttempt(attemptId, principal);
    const exam = await this.db.exam(attempt.exam_id);
    const changed = await this.cache.heartbeat(exam, attemptId);
    return { examId: exam.id, attemptId, changed };
  }

  // Kiểm tra loại vi phạm và clientAt, sau đó ghi DB trước khi phát sự kiện
  async violation(
    payload: unknown,
    principal: Principal,
  ): Promise<{ examId: string; attemptId: string; at: string }> {
    const data = objectPayload(payload);
    const attemptId = assertUuid(data.attemptId, 'attemptId');
    const types: ViolationType[] = [
      'TAB_BLUR',
      'FULLSCREEN_EXIT',
      'COPY_PASTE',
      'DISCONNECT',
    ];
    if (!types.includes(data.type as ViolationType))
      throw new RealtimeError('INVALID_PAYLOAD', 'Unknown violation type');
    let clientAt: Date | null = null;
    if (data.clientAt !== undefined && data.clientAt !== null) {
      if (
        typeof data.clientAt !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(
          data.clientAt,
        ) ||
        Number.isNaN(Date.parse(data.clientAt))
      ) {
        throw new RealtimeError(
          'INVALID_PAYLOAD',
          'clientAt must be an ISO date',
        );
      }
      clientAt = new Date(data.clientAt);
    }
    const attempt = await this.db.activeAttempt(attemptId, principal);
    const at = await this.db.recordViolation(
      attemptId,
      principal,
      data.type as ViolationType,
      clientAt,
    );
    return { examId: attempt.exam_id, attemptId, at };
  }

  // Kết hợp dữ liệu bền vững ở DB với sự hiện diện tạm thời ở Redis
  async studentUpdate(attemptId: string): Promise<StudentUpdate> {
    const update = await this.db.studentUpdate(attemptId);
    const heartbeat = await this.cache.lastHeartbeat(update.examId, attemptId);
    return {
      ...update,
      online:
        update.status === 'IN_PROGRESS' &&
        heartbeat !== null &&
        heartbeat >= Date.now() - 30000,
      lastHeartbeat:
        heartbeat === null ? null : new Date(heartbeat).toISOString(),
    };
  }

  // Xử lý kỳ thi đã quá hạn, dọn presence của các attempt vừa auto-submit
  async finishExpired(
    examId: string,
  ): Promise<{ exam: Exam; submissions: Submitted[]; ended: boolean } | null> {
    const result = await this.db.finishExpired(examId);
    if (result) {
      await this.cacheAfterCommit(result.exam);
      for (const submission of result.submissions) {
        try {
          await this.cache.removePresence(examId, submission.attemptId);
        } catch (error) {
          this.logger.error('Presence cleanup failed', {
            examId,
            attemptId: submission.attemptId,
            error,
          });
        }
      }
    }
    return result;
  }
}
