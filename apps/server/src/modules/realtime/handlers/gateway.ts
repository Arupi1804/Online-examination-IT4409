/* SOCKET.IO GATEWAY: BIÊN GIAO TIẾP REALTIME VỚI CLIENT */

import type { Namespace, Socket } from 'socket.io';
import {
  clientEvents,
  serverEvents,
  type Ack,
  type ExamClock,
  type Submitted,
} from '../../../shared/realtime.js';
import { RealtimeError } from '../errors.js';
import type { AuthSessions } from '../../auth/session.js';
import type { Principal } from '../../auth/types.js';
import { RealtimeService } from '../services/service.js';

type SocketWithPrincipal = Socket & {
  data: { principal: Principal; joinedExams?: Set<string> };
};
type AckFn = (response: Ack<unknown>) => void;
const limits: Record<string, number> = {
  [clientEvents.join]: 20,
  [clientEvents.rejoin]: 20,
  [clientEvents.start]: 10,
  [clientEvents.extend]: 10,
  [clientEvents.forceSubmit]: 10,
  [clientEvents.heartbeat]: 20,
  [clientEvents.violation]: 30,
};

// Chuyển lỗi nội bộ về mã lỗi public; che thông tin chi tiết khi là lỗi không dự kiến
function socketError(error: unknown): {
  code: 'INTERNAL_ERROR' | RealtimeError['code'];
  message: string;
} {
  if (error instanceof RealtimeError)
    return { code: error.code, message: error.message };
  return { code: 'INTERNAL_ERROR', message: 'Realtime operation failed' };
}

// Các dependency bắt buộc từ Bootstrap
export type GatewayOptions = {
  namespace: Namespace;
  sessions: AuthSessions;
  service: RealtimeService;
  logger?: Pick<Console, 'error'>;
};

/** Attach realtime handlers to the Auth-protected /exam namespace. */
export function createRealtimeGateway(options: GatewayOptions) {
  const { namespace, service } = options;
  const logger = options.logger ?? console;
  const lastSyncedDeadline = new Map<string, number>();
  options.sessions.attachSocketAuthentication(namespace);

  // Không phát snapshot worker cũ sau khi đã phát thời hạn gia hạn mới.
  function emitTimerSync(state: ExamClock): void {
    const deadline = state.endTime ? Date.parse(state.endTime) : 0;
    if (deadline < (lastSyncedDeadline.get(state.examId) ?? 0)) return;
    lastSyncedDeadline.set(state.examId, deadline);
    namespace.to(`exam:${state.examId}`).emit(serverEvents.timerSync, state);
  }

  // Phát attempt:submitted vào phòng riêng của user và phòng monitor
  function emitSubmitted(submission: Submitted): void {
    namespace
      .to(`user:${submission.userId}`)
      .emit(serverEvents.attemptSubmitted, submission);
    namespace
      .to(`monitor:${submission.examId}`)
      .emit(serverEvents.attemptSubmitted, submission);
  }

  // Tải thông tin mới nhất và broadcast dashboard
  async function emitStudentUpdate(attemptId: string): Promise<void> {
    const update = await service.studentUpdate(attemptId);
    namespace
      .to(`monitor:${update.examId}`)
      .emit(serverEvents.studentUpdate, update);
  }

  // Tạo handler cho một socket đã xác thực thành công
  const onConnection = (raw: Socket) => {
    const socket = raw as SocketWithPrincipal;
    const principal = socket.data.principal;
    socket.join(`user:${principal.userId}`);

    // Wrapper thống nhất cho mọi event: session, rate limit, bắt lỗi, ACK
    function handle(event: string, fn: (payload: unknown) => Promise<unknown>) {
      socket.on(event, async (payload: unknown, ack?: AckFn) => {
        try {
          await service.cache.rateLimit(
            principal.userId,
            event,
            limits[event] ?? 10,
          );
          const data = await fn(payload);
          if (typeof ack === 'function') ack({ ok: true, data });
        } catch (error) {
          if (!(error instanceof RealtimeError))
            logger.error('Realtime event failed', { event, error });
          const reason = socketError(error);
          if (typeof ack === 'function') ack({ ok: false, error: reason });
        }
      });
    }

    // Event phòng chờ: kiểm tra quyền, vào room exam/monitor, phát trạng thái
    handle(clientEvents.join, async (payload) => {
      const { state, monitor } = await service.join(payload, principal);
      const room = `exam:${state.examId}`;
      await socket.join(room);
      if (monitor) await socket.join(`monitor:${state.examId}`);
      socket.data.joinedExams ??= new Set();
      const firstJoin = !socket.data.joinedExams.has(state.examId);
      socket.data.joinedExams.add(state.examId);
      state.participantCount = (await namespace.in(room).allSockets()).size;
      socket.emit(serverEvents.roomState, state);
      if (firstJoin)
        socket.to(room).emit(serverEvents.participantJoined, {
          examId: state.examId,
          userId: principal.userId,
          role: principal.role,
        });
      return state;
    });

    // Event giáo viên bắt đầu thi: DB commit trước, sau đó phát event và đặt lại worker
    handle(clientEvents.start, async (payload) => {
      const clock = await service.start(payload, principal);
      namespace
        .to(`exam:${clock.examId}`)
        .emit(serverEvents.examStarted, clock);
      emitTimerSync(clock);
      onScheduleChanged?.(clock.examId);
      return clock;
    });

    // Event gia hạn tương tự start nhưng thay end_time
    handle(clientEvents.extend, async (payload) => {
      const clock = await service.extend(payload, principal);
      namespace
        .to(`exam:${clock.examId}`)
        .emit(serverEvents.examExtended, clock);
      emitTimerSync(clock);
      onScheduleChanged?.(clock.examId);
      return clock;
    });

    // Khôi phục attempt của học sinh sau reconnect
    handle(clientEvents.rejoin, async (payload) => {
      const state = await service.rejoin(payload, principal);
      await socket.join(`exam:${state.examId}`);
      socket.data.joinedExams ??= new Set();
      socket.data.joinedExams.add(state.examId);
      socket.emit(serverEvents.attemptState, state);
      return state;
    });

    // Giáo viên ép nộp: chỉ broadcast khi DB thực sự chuyển status
    handle(clientEvents.forceSubmit, async (payload) => {
      const submitted = await service.forceSubmit(payload, principal);
      if (submitted) {
        try {
          await service.cache.removePresence(
            submitted.examId,
            submitted.attemptId,
          );
        } catch (error) {
          logger.error('Presence cleanup failed', {
            attemptId: submitted.attemptId,
            error,
          });
        }
        emitSubmitted(submitted);
        try {
          await emitStudentUpdate(submitted.attemptId);
        } catch (error) {
          logger.error('Monitor refresh failed after submission', {
            attemptId: submitted.attemptId,
            error,
          });
        }
      }
      return { submitted: submitted !== null, attempt: submitted };
    });

    // Nhận heartbeat online từ học sinh đang thi
    handle(clientEvents.heartbeat, async (payload) => {
      const result = await service.heartbeat(payload, principal);
      if (result.changed) {
        try {
          await emitStudentUpdate(result.attemptId);
        } catch (error) {
          logger.error('Monitor refresh failed after heartbeat', {
            attemptId: result.attemptId,
            error,
          });
        }
      }
      return { serverTime: new Date().toISOString() };
    });

    // Ghi log vi phạm vào DB, sau đó cập nhật dashboard
    handle(clientEvents.violation, async (payload) => {
      const result = await service.violation(payload, principal);
      try {
        await emitStudentUpdate(result.attemptId);
      } catch (error) {
        logger.error('Monitor refresh failed after violation', {
          attemptId: result.attemptId,
          error,
        });
      }
      return { at: result.at };
    });

    // Khi một socket ngắt, thông báo rời phòng nhưng không kết luận ngay là offline
    socket.on('disconnect', () => {
      for (const examId of socket.data.joinedExams ?? []) {
        socket.to(`exam:${examId}`).emit(serverEvents.participantLeft, {
          examId,
          userId: principal.userId,
          role: principal.role,
        });
      }
    });
  };
  namespace.on('connection', onConnection);

  // Giữ callback tùy chọn để Gateway thông báo Worker khi start/extend
  let onScheduleChanged: ((examId: string) => void) | undefined;

  // Trả API public cho bootstrap và worker gọi phát sự kiện/đóng server
  return {
    namespace,

    // Worker đăng ký callback nhận thay đổi lịch thi từ Gateway
    setScheduleListener(listener: (examId: string) => void) {
      onScheduleChanged = listener;
    },
    emitSubmitted,
    emitStudentUpdate,
    emitTimerSync,

    // Only detach realtime handlers; bootstrap owns Socket.IO shutdown.
    close() {
      namespace.off('connection', onConnection);
    },
  };
}

export type RealtimeGateway = ReturnType<typeof createRealtimeGateway>;
