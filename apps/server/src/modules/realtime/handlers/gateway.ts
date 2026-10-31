/* SOCKET.IO GATEWAY: BIÊN GIAO TIẾP REALTIME VỚI CLIENT */

import type { Server as HttpServer } from 'node:http';
import type { RequestHandler } from 'express';
import type { Store } from 'express-session';
import { Server, type Socket } from 'socket.io';
import {
  clientEvents,
  serverEvents,
  type Ack,
  type Role,
  type Submitted,
} from '../../../shared/realtime.js';
import { RealtimeError } from '../errors.js';
import type { Principal } from '../services/repository.js';
import { RealtimeService } from '../services/service.js';

type SessionIdentity = { userId?: unknown; role?: unknown };
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
  httpServer: HttpServer;
  sessionMiddleware: RequestHandler;
  sessionStore: Store;
  service: RealtimeService;
  clientOrigin: string;
  logger?: Pick<Console, 'error'>;
};

/** Attach to the same HTTP server and express-session store used by REST. */

// Khởi tạo một Socket.IO Server trên HTTP server hiện có và đăng ký handler
export function createRealtimeGateway(options: GatewayOptions) {
  const { service, sessionStore } = options;
  const logger = options.logger ?? console;

  // Tạo Socket.IO với cấu hình CORS, kích thước thông điệp và recovery
  const io = new Server(options.httpServer, {
    cors: { origin: options.clientOrigin, credentials: true },
    maxHttpBufferSize: 16_384,
    connectionStateRecovery: { skipMiddlewares: false },
  });

  // Gắn express-session vào handshake Engine.IO để có sessionID từ cookie
  io.engine.use(
    (
      request: Parameters<RequestHandler>[0],
      response: Parameters<RequestHandler>[1],
      next: Parameters<RequestHandler>[2],
    ) => {
      const query = (request as typeof request & { _query?: { sid?: string } })
        ._query;
      if (query?.sid !== undefined) {
        next();
        return;
      }
      options.sessionMiddleware(
        request as Parameters<RequestHandler>[0],
        response as Parameters<RequestHandler>[1],
        next,
      );
    },
  );

  // Đọc lại session và đối chiếu active_session mỗi khi kết nối hoặc có event
  async function principalFor(sid: string | undefined): Promise<Principal> {
    if (!sid) throw new RealtimeError('UNAUTHENTICATED', 'Login required');
    const session = await new Promise<SessionIdentity | null>(
      (resolve, reject) => {
        sessionStore.get(sid, (error, stored) =>
          error
            ? reject(error)
            : resolve((stored ?? null) as SessionIdentity | null),
        );
      },
    );
    if (
      !session ||
      typeof session.userId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        session.userId,
      ) ||
      !['ADMIN', 'TEACHER', 'STUDENT'].includes(session.role as string)
    ) {
      throw new RealtimeError('UNAUTHENTICATED', 'Login required');
    }
    const principal = {
      userId: session.userId.toLowerCase(),
      role: session.role as Role,
      sid,
    };
    await service.cache.assertActiveSession(principal.userId, sid);
    return principal;
  }

  // Middleware kết nối chạy trước khi chấp nhận socket mới
  io.use((socket, next) => {
    const sid = (
      socket.request as typeof socket.request & { sessionID?: string }
    ).sessionID;
    principalFor(sid)
      .then((principal) => {
        (socket as SocketWithPrincipal).data.principal = principal;
        next();
      })
      .catch((error) => {
        const reason = socketError(error);
        const rejection = new Error(reason.message) as Error & {
          data?: unknown;
        };
        rejection.data = { code: reason.code };
        next(rejection);
      });
  });

  // Phát attempt:submitted vào phòng riêng của user và phòng monitor
  function emitSubmitted(submission: Submitted): void {
    io.to(`user:${submission.userId}`).emit(
      serverEvents.attemptSubmitted,
      submission,
    );
    io.to(`monitor:${submission.examId}`).emit(
      serverEvents.attemptSubmitted,
      submission,
    );
  }

  // Tải thông tin mới nhất và broadcast dashboard
  async function emitStudentUpdate(attemptId: string): Promise<void> {
    const update = await service.studentUpdate(attemptId);
    io.to(`monitor:${update.examId}`).emit(serverEvents.studentUpdate, update);
  }

  // Tạo handler cho một socket đã xác thực thành công
  io.on('connection', (raw) => {
    const socket = raw as SocketWithPrincipal;
    const principal = socket.data.principal;
    socket.join(`user:${principal.userId}`);

    // Wrapper thống nhất cho mọi event: session, rate limit, bắt lỗi, ACK
    function handle(event: string, fn: (payload: unknown) => Promise<unknown>) {
      socket.on(event, async (payload: unknown, ack?: AckFn) => {
        try {
          const current = await principalFor(principal.sid);
          if (
            current.userId !== principal.userId ||
            current.role !== principal.role
          )
            throw new RealtimeError('SESSION_REPLACED', 'Session changed');
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
          if (
            reason.code === 'UNAUTHENTICATED' ||
            reason.code === 'SESSION_REPLACED'
          ) {
            if (reason.code === 'SESSION_REPLACED')
              socket.emit(serverEvents.sessionReplaced, {
                reason: reason.code,
              });
            socket.disconnect(true);
          }
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
      state.participantCount = (await io.in(room).allSockets()).size;
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
      io.to(`exam:${clock.examId}`).emit(serverEvents.examStarted, clock);
      io.to(`exam:${clock.examId}`).emit(serverEvents.timerSync, clock);
      onScheduleChanged?.(clock.examId);
      return clock;
    });

    // Event gia hạn tương tự start nhưng thay end_time
    handle(clientEvents.extend, async (payload) => {
      const clock = await service.extend(payload, principal);
      io.to(`exam:${clock.examId}`).emit(serverEvents.examExtended, clock);
      io.to(`exam:${clock.examId}`).emit(serverEvents.timerSync, clock);
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
  });

  // Giữ callback tùy chọn để Gateway thông báo Worker khi start/extend
  let onScheduleChanged: ((examId: string) => void) | undefined;

  // Trả API public cho bootstrap và worker gọi phát sự kiện/đóng server
  return {
    io,

    // Worker đăng ký callback nhận thay đổi lịch thi từ Gateway
    setScheduleListener(listener: (examId: string) => void) {
      onScheduleChanged = listener;
    },
    emitSubmitted,
    emitStudentUpdate,

    // Auth có thể gọi để chủ động đẩy các socket thuộc phiên cũ ra ngoài
    notifySessionReplaced(userId: string, oldSid: string) {
      for (const socket of io.sockets.sockets.values()) {
        const current = socket as SocketWithPrincipal;
        if (
          current.data.principal?.userId === userId &&
          current.data.principal.sid === oldSid
        ) {
          current.emit(serverEvents.sessionReplaced, {
            reason: 'SESSION_REPLACED',
          });
          current.disconnect(true);
        }
      }
    },

    // Đóng Socket.IO Server trong shutdown, không tự đóng HTTP server dùng chung
    async close() {
      await new Promise<void>((resolve) => io.close(() => resolve()));
    },
  };
}

export type RealtimeGateway = ReturnType<typeof createRealtimeGateway>;
