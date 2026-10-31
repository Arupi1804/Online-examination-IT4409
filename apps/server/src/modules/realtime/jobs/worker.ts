/* WORKER XỬ LÝ DEADLINE VÀ GIÁM SÁT THEO CHU KỲ */

import { serverEvents } from '../../../shared/realtime.js';
import { clock, type Exam } from '../services/repository.js';
import type { RealtimeGateway } from '../handlers/gateway.js';
import { RealtimeService } from '../services/service.js';

/** PostgreSQL-backed deadline scheduler; every tick is safe to replay after a restart. */

// Lớp xử lý deadline và giám sát tách khỏi HTTP request
export class RealtimeWorker {
  private timer: ReturnType<typeof setInterval> | undefined;
  private deadlines = new Map<string, ReturnType<typeof setTimeout>>();
  private busy = false;
  private lastSync = 0;
  constructor(
    private readonly service: RealtimeService,
    private readonly gateway: RealtimeGateway,
    private readonly logger: Pick<Console, 'error'> = console,
  ) {}

  // Chạy tick ngay khi khởi động để khôi phục kỳ thi quá hạn, sau đó quét mỗi 10 giây
  async start(): Promise<void> {
    await this.tick();
    this.timer = setInterval(
      () =>
        void this.tick().catch((error) =>
          this.logger.error('Realtime worker tick failed', error),
        ),
      10_000,
    );
    this.timer.unref();
    this.gateway.setScheduleListener(
      (examId) =>
        void this.scheduleExam(examId).catch((error) =>
          this.logger.error('Deadline schedule failed', error),
        ),
    );
  }

  // Cài lại timeout của một kỳ thi dựa trên end_time lấy từ DB
  private arm(exam: Exam): void {
    const previous = this.deadlines.get(exam.id);
    if (previous) clearTimeout(previous);
    this.deadlines.delete(exam.id);
    if (exam.status !== 'RUNNING' || !exam.end_time) return;
    const remaining = exam.end_time.getTime() + 5001 - Date.now();
    const delay = remaining > 0 ? remaining : 1000;
    if (delay > 2_147_483_647) return;
    const timer = setTimeout(() => {
      this.deadlines.delete(exam.id);
      void this.finish(exam.id).catch((error) =>
        this.logger.error('Deadline job failed', { examId: exam.id, error }),
      );
    }, delay);
    timer.unref();
    this.deadlines.set(exam.id, timer);
  }

  // Đọc lại row mới nhất sau khi start/extend; không dùng deadline gửi từ client
  async scheduleExam(examId: string): Promise<void> {
    this.arm(await this.service.db.exam(examId));
  }

  // Chốt kỳ thi bằng DB rồi mới phát submitted/update/ended
  private async finish(examId: string): Promise<void> {
    const result = await this.service.finishExpired(examId);
    if (!result) {
      this.arm(await this.service.db.exam(examId));
      return;
    }
    for (const submitted of result.submissions) {
      this.gateway.emitSubmitted(submitted);
      try {
        await this.gateway.emitStudentUpdate(submitted.attemptId);
      } catch (error) {
        this.logger.error('Monitor refresh failed after auto-submit', {
          attemptId: submitted.attemptId,
          error,
        });
      }
    }
    if (result.ended)
      this.gateway.io
        .to(`exam:${examId}`)
        .emit(serverEvents.examEnded, clock(result.exam));
  }

  // Một chu kỳ: lấy các exam cần xét, xử lý deadline, sync đồng hồ, quét offline
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const running = await this.service.db.runningExams();
      const ended = await this.service.db.unfinishedEndedExams();
      const now = Date.now();

      // Duyệt cả kỳ thi đang thi và kỳ thi cần phục hồi sau lỗi
      for (const exam of [...running, ...ended]) {
        if (exam.end_time && exam.end_time.getTime() + 5000 < now)
          await this.finish(exam.id);
        else if (exam.status === 'RUNNING') this.arm(exam);
      }

      // Chỉ kỳ thi đang mở mới cần đồng hồ/heartbeat
      for (const exam of running) {
        if (!exam.end_time || exam.end_time.getTime() <= now) continue;
        if (now - this.lastSync >= 10_000)
          this.gateway.io
            .to(`exam:${exam.id}`)
            .emit(serverEvents.timerSync, clock(exam));
        for (const id of await this.service.cache.offlineCandidates(
          exam.id,
          now - 30_000,
        )) {
          if (await this.service.cache.markOffline(exam.id, id, now - 30_000))
            await this.gateway.emitStudentUpdate(id);
        }
      }
      this.lastSync = now;
    } finally {
      this.busy = false;
    }
  }

  // Hủy interval và tất cả timeout để tránh worker tiếp tục chạy sau shutdown
  stop(): void {
    if (this.timer) clearInterval(this.timer);
    for (const timer of this.deadlines.values()) clearTimeout(timer);
    this.deadlines.clear();
  }
}
