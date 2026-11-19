/* TẦNG TRUY CẬP POSTGRESQL CHO NGHIỆP VỤ REALTIME */

import {
  Prisma,
  type Attempt as PrismaAttempt,
  type Exam as PrismaExam,
  type PrismaClient,
} from '@prisma/client';
import type {
  AttemptState,
  AttemptStatus,
  ExamClock,
  ExamStatus,
  Role,
  StudentUpdate,
  Submitted,
  ViolationType,
} from '../../../shared/realtime.js';
import { databaseNow } from '../../../core/db/clock.js';
import { isRetryableTransactionError } from '../../../core/db/transaction-error.js';
import {
  lockAttempt,
  lockExpiredExam,
  lockOpenAttempts,
} from '../../../core/db/locks.js';
import {
  gradeAttempt,
  type GradedQuestion,
} from '../../attempts/services/grading.js';
import { RealtimeError } from '../errors.js';

export type Principal = { userId: string; role: Role; sid: string };
export type Exam = {
  id: string;
  owner_id: string;
  room_code: string;
  status: ExamStatus;
  start_time: Date | null;
  end_time: Date | null;
  duration_sec: number;
};
type Attempt = {
  id: string;
  exam_id: string;
  user_id: string;
  status: AttemptStatus;
  submitted_at: Date | null;
};

// Chuyển bản ghi Prisma sang cấu trúc kỳ thi dùng trong realtime
function toExam(row: PrismaExam): Exam {
  return {
    id: row.id,
    owner_id: row.ownerId,
    room_code: row.roomCode,
    status: row.status as ExamStatus,
    start_time: row.startTime,
    end_time: row.endTime,
    duration_sec: row.durationSec,
  };
}

// Chuyển bản ghi Prisma sang cấu trúc bài làm dùng trong realtime
function toAttempt(row: PrismaAttempt): Attempt {
  return {
    id: row.id,
    exam_id: row.examId,
    user_id: row.userId,
    status: row.status as AttemptStatus,
    submitted_at: row.submittedAt,
  };
}

// Tạo đồng hồ kỳ thi với thời gian phản hồi hiện tại của server
export function clock(exam: Exam): ExamClock {
  return {
    examId: exam.id,
    status: exam.status,
    startTime: exam.start_time?.toISOString() ?? null,
    endTime: exam.end_time?.toISOString() ?? null,
    serverTime: new Date().toISOString(),
  };
}

// PostgreSQL là nguồn dữ liệu chính cho mọi thao tác realtime
export class RealtimeRepository {
  // Dùng chung PrismaClient do bootstrap quản lý
  constructor(private readonly prisma: PrismaClient) {}

  // Chạy transaction Serializable và thử lại khi các thao tác đồng thời xung đột
  private async serializable<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await this.prisma.$transaction(work, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          maxWait: 30_000,
          timeout: 120_000,
        });
      } catch (error) {
        // Chỉ thử lại lỗi giao dịch có thể phục hồi; lỗi khác được trả ngay
        if (!isRetryableTransactionError(error) || attempt === 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
    throw new Error('Unreachable transaction state');
  }

  // Tìm kỳ thi theo ID và báo lỗi nếu không tồn tại
  async exam(examId: string): Promise<Exam> {
    const row = await this.prisma.exam.findUnique({ where: { id: examId } });
    if (!row) throw new RealtimeError('NOT_FOUND', 'Exam not found');
    return toExam(row);
  }

  // Tìm kỳ thi theo mã phòng để phục vụ luồng tham gia phòng
  async examByCode(code: string): Promise<Exam> {
    const row = await this.prisma.exam.findUnique({
      where: { roomCode: code },
    });
    if (!row) throw new RealtimeError('NOT_FOUND', 'Exam not found');
    return toExam(row);
  }

  // Cho admin, giáo viên sở hữu hoặc học sinh có mã phòng/bài làm vào phòng
  async canJoin(
    exam: Exam,
    principal: Principal,
    roomCode?: string,
  ): Promise<void> {
    // Chủ kỳ thi và admin có quyền truy cập trực tiếp
    if (
      principal.role === 'ADMIN' ||
      (principal.role === 'TEACHER' && exam.owner_id === principal.userId)
    )
      return;
    if (principal.role !== 'STUDENT')
      throw new RealtimeError('FORBIDDEN', 'Exam access denied');
    // Mã phòng hợp lệ cho phép học sinh vào; khi kết nối lại dùng bài làm đã có
    if (roomCode === exam.room_code) return;
    const attempt = await this.prisma.attempt.findFirst({
      where: { examId: exam.id, userId: principal.userId },
      select: { id: true },
    });
    if (!attempt) throw new RealtimeError('FORBIDDEN', 'Exam access denied');
  }

  // Xác nhận người gọi là giáo viên sở hữu kỳ thi trước khi thay đổi trạng thái
  assertTeacher(exam: Exam, principal: Principal): void {
    if (principal.role !== 'TEACHER' || exam.owner_id !== principal.userId)
      throw new RealtimeError('FORBIDDEN', 'Teacher does not own exam');
  }

  // Chuyển kỳ thi SCHEDULED có câu hỏi sang RUNNING trong một transaction
  async start(examId: string, principal: Principal): Promise<Exam> {
    return this.serializable(async (tx) => {
      const current = await tx.exam.findUnique({
        where: { id: examId },
        include: { _count: { select: { questions: true } } },
      });
      if (!current) throw new RealtimeError('NOT_FOUND', 'Exam not found');
      this.assertTeacher(toExam(current), principal);
      if (current.status !== 'SCHEDULED' || current._count.questions === 0)
        throw new RealtimeError('INVALID_STATE', 'Exam cannot be started');
      // Dùng giờ DB làm mốc bắt đầu và tính hạn kết thúc chung cho kỳ thi
      const now = await databaseNow(tx);
      // Kiểm tra lại trạng thái ngay trong lệnh ghi để tránh khởi động hai lần
      const result = await tx.exam.updateMany({
        where: {
          id: examId,
          ownerId: principal.userId,
          status: 'SCHEDULED',
          durationSec: current.durationSec,
          questions: { some: {} },
        },
        data: {
          status: 'RUNNING',
          startTime: now,
          endTime: new Date(now.getTime() + current.durationSec * 1000),
        },
      });
      if (!result.count)
        throw new RealtimeError('INVALID_STATE', 'Exam cannot be started');
      return toExam(await tx.exam.findUniqueOrThrow({ where: { id: examId } }));
    });
  }

  // Gia hạn kỳ thi còn RUNNING và chưa hết giờ trong một transaction
  async extend(
    examId: string,
    seconds: number,
    principal: Principal,
  ): Promise<Exam> {
    return this.serializable(async (tx) => {
      const current = await tx.exam.findUnique({ where: { id: examId } });
      if (!current) throw new RealtimeError('NOT_FOUND', 'Exam not found');
      this.assertTeacher(toExam(current), principal);
      // Giờ DB quyết định kỳ thi còn được gia hạn hay không
      const now = await databaseNow(tx);
      if (
        current.status !== 'RUNNING' ||
        !current.endTime ||
        current.endTime <= now
      )
        throw new RealtimeError(
          'INVALID_STATE',
          'Exam can no longer be extended',
        );
      // Điều kiện endTime được kiểm tra lại khi ghi để chặn gia hạn sau hạn chót
      const result = await tx.exam.updateMany({
        where: {
          id: examId,
          ownerId: principal.userId,
          status: 'RUNNING',
          endTime: { gt: now },
        },
        data: { endTime: new Date(current.endTime.getTime() + seconds * 1000) },
      });
      if (!result.count)
        throw new RealtimeError(
          'INVALID_STATE',
          'Exam can no longer be extended',
        );
      return toExam(await tx.exam.findUniqueOrThrow({ where: { id: examId } }));
    });
  }

  // Đọc bài làm và đáp án đã lưu để học sinh khôi phục trạng thái khi kết nối lại
  async attemptState(
    attemptId: string,
    principal: Principal,
  ): Promise<AttemptState> {
    const row = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: true,
        // Sắp xếp ổn định để trạng thái trả về không phụ thuộc thứ tự đọc từ DB
        answers: {
          orderBy: { questionId: 'asc' },
          include: {
            selectedOptions: {
              orderBy: { optionId: 'asc' },
              select: { optionId: true },
            },
          },
        },
      },
    });
    if (!row) throw new RealtimeError('NOT_FOUND', 'Attempt not found');
    if (principal.role !== 'STUDENT' || row.userId !== principal.userId)
      throw new RealtimeError('FORBIDDEN', 'Attempt access denied');
    return {
      attemptId,
      examId: row.examId,
      status: row.status as AttemptStatus,
      submittedAt: row.submittedAt?.toISOString() ?? null,
      answers: row.answers.map((answer) => ({
        questionId: answer.questionId,
        optionIds: answer.selectedOptions.map(
          (selection) => selection.optionId,
        ),
      })),
      clock: clock(toExam(row.exam)),
    };
  }

  // Ghi vi phạm của bài làm đang thi sau khi kiểm tra quyền và hạn kỳ thi
  async recordViolation(
    attemptId: string,
    principal: Principal,
    type: ViolationType,
    clientAt: Date | null,
  ): Promise<string> {
    if (principal.role !== 'STUDENT')
      throw new RealtimeError('FORBIDDEN', 'Student role required');
    return this.serializable(async (tx) => {
      const row = await tx.attempt.findUnique({
        where: { id: attemptId },
        include: { exam: true },
      });
      // Kiểm tra thời hạn bằng giờ DB trong cùng transaction với lệnh ghi log
      const now = await databaseNow(tx);
      if (
        !row ||
        row.userId !== principal.userId ||
        row.status !== 'IN_PROGRESS' ||
        row.exam.status !== 'RUNNING' ||
        !row.exam.endTime ||
        row.exam.endTime <= now
      )
        throw new RealtimeError('INVALID_STATE', 'Attempt is not active');
      const log = await tx.proctorLog.create({
        data: { attemptId, type, clientAt },
      });
      return log.at.toISOString();
    });
  }

  // Xác nhận bài làm thuộc học sinh và còn hoạt động cho các sự kiện realtime
  async activeAttempt(
    attemptId: string,
    principal: Principal,
  ): Promise<Attempt> {
    const row = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: { exam: true },
    });
    if (!row) throw new RealtimeError('NOT_FOUND', 'Attempt not found');
    if (principal.role !== 'STUDENT' || row.userId !== principal.userId)
      throw new RealtimeError('FORBIDDEN', 'Attempt access denied');
    // Không nhận sự kiện khi kỳ thi đã hết hạn theo giờ DB
    const now = await databaseNow(this.prisma);
    if (
      row.status !== 'IN_PROGRESS' ||
      row.exam.status !== 'RUNNING' ||
      !row.exam.endTime ||
      row.exam.endTime <= now
    )
      throw new RealtimeError('INVALID_STATE', 'Attempt is not active');
    return toAttempt(row);
  }

  // Lấy trạng thái, số câu đã trả lời và vi phạm gần nhất cho dashboard
  async studentUpdate(
    attemptId: string,
  ): Promise<Omit<StudentUpdate, 'online' | 'lastHeartbeat'>> {
    const row = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      select: {
        examId: true,
        userId: true,
        status: true,
        _count: { select: { answers: true, proctorLogs: true } },
        proctorLogs: {
          orderBy: { at: 'desc' },
          take: 1,
          select: { type: true, at: true },
        },
      },
    });
    if (!row) throw new RealtimeError('NOT_FOUND', 'Attempt not found');
    const latest = row.proctorLogs[0];
    return {
      examId: row.examId,
      attemptId,
      userId: row.userId,
      status: row.status as AttemptStatus,
      answeredCount: row._count.answers,
      violationCount: row._count.proctorLogs,
      lastViolation: latest
        ? { type: latest.type as ViolationType, at: latest.at.toISOString() }
        : null,
    };
  }

  // Liệt kê bài làm theo thời điểm bắt đầu để dựng danh sách giám sát ổn định
  async monitor(examId: string): Promise<string[]> {
    const rows = await this.prisma.attempt.findMany({
      where: { examId },
      orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  // Lấy các kỳ thi đang chạy để worker đồng bộ lịch và hiện diện
  async runningExams(): Promise<Exam[]> {
    const rows = await this.prisma.exam.findMany({
      where: { status: 'RUNNING' },
    });
    return rows.map(toExam);
  }

  // Tìm kỳ thi đã kết thúc nhưng còn bài chưa nộp để worker khôi phục xử lý
  async unfinishedEndedExams(): Promise<Exam[]> {
    const rows = await this.prisma.exam.findMany({
      where: { status: 'ENDED', attempts: { some: { status: 'IN_PROGRESS' } } },
    });
    return rows.map(toExam);
  }

  // Đọc điểm, đáp án đúng và lựa chọn của bài làm trong transaction nộp bài
  private async loadGradingQuestions(
    tx: Prisma.TransactionClient,
    attemptId: string,
    examId: string,
  ): Promise<GradedQuestion[]> {
    const questions = await tx.examQuestion.findMany({
      where: { examId },
      select: {
        questionId: true,
        points: true,
        question: {
          select: {
            options: { where: { isCorrect: true }, select: { id: true } },
          },
        },
        answers: {
          where: { attemptId },
          select: { selectedOptions: { select: { optionId: true } } },
        },
      },
    });
    // Chuẩn hóa dữ liệu Prisma theo đầu vào của gradeAttempt()
    return questions.map((question) => ({
      questionId: question.questionId,
      points: Number(question.points),
      correctOptionIds: question.question.options.map((option) => option.id),
      selectedOptionIds: question.answers.flatMap((answer) =>
        answer.selectedOptions.map((selection) => selection.optionId),
      ),
    }));
  }

  // Chấm và chốt một bài làm đã được khóa; trả null nếu bài đã nộp
  private async submitLocked(
    tx: Prisma.TransactionClient,
    attempt: Attempt,
    status: Exclude<AttemptStatus, 'IN_PROGRESS'>,
  ): Promise<Submitted | null> {
    if (attempt.status !== 'IN_PROGRESS') return null;
    // Chỉ gradeAttempt quyết định điểm; phần đọc và ghi vẫn ở cùng transaction
    const { score, maxScore } = gradeAttempt(
      await this.loadGradingQuestions(tx, attempt.id, attempt.exam_id),
    );
    const submittedAt = await databaseNow(tx);
    // Điều kiện IN_PROGRESS bảo đảm chỉ một lần chuyển trạng thái thành công
    const result = await tx.attempt.updateMany({
      where: { id: attempt.id, status: 'IN_PROGRESS' },
      data: { status, submittedAt, score, maxScore },
    });
    if (!result.count) return null;
    return {
      attemptId: attempt.id,
      examId: attempt.exam_id,
      userId: attempt.user_id,
      status,
      submittedAt: submittedAt.toISOString(),
    };
  }

  // Giáo viên sở hữu kỳ thi ép nộp một bài đang thi, trong transaction có khóa
  async forceSubmit(
    attemptId: string,
    principal: Principal,
  ): Promise<Submitted | null> {
    return this.serializable(async (tx) => {
      // Khóa bài làm trước khi kiểm tra trạng thái để tránh nộp đồng thời
      await lockAttempt(tx, attemptId);
      const row = await tx.attempt.findUnique({
        where: { id: attemptId },
        include: { exam: true },
      });
      if (!row) throw new RealtimeError('NOT_FOUND', 'Attempt not found');
      if (principal.role !== 'TEACHER' || row.exam.ownerId !== principal.userId)
        throw new RealtimeError('FORBIDDEN', 'Teacher does not own exam');
      if (row.status === 'IN_PROGRESS' && row.exam.status !== 'RUNNING')
        throw new RealtimeError('INVALID_STATE', 'Exam is not running');
      return this.submitLocked(tx, toAttempt(row), 'FORCE_SUBMITTED');
    });
  }

  // Tự nộp các bài quá hạn và chuyển kỳ thi sang ENDED khi cần
  async finishExpired(
    examId: string,
  ): Promise<{ exam: Exam; submissions: Submitted[]; ended: boolean } | null> {
    return this.serializable(async (tx) => {
      // Khóa kỳ thi sau khoảng chờ 5 giây để các worker không chốt đồng thời
      if (!(await lockExpiredExam(tx, examId))) return null;
      const row = await tx.exam.findUnique({ where: { id: examId } });
      if (!row || !['RUNNING', 'ENDED'].includes(row.status)) return null;
      // Khóa toàn bộ bài chưa nộp trước khi chấm để không trùng với force submit
      await lockOpenAttempts(tx, examId);
      const attempts = await tx.attempt.findMany({
        where: { examId, status: 'IN_PROGRESS' },
      });
      const submissions: Submitted[] = [];
      for (const attempt of attempts) {
        const submitted = await this.submitLocked(
          tx,
          toAttempt(attempt),
          'AUTO_SUBMITTED',
        );
        if (submitted) submissions.push(submitted);
      }
      // Kỳ thi ENDED vẫn có thể còn bài cần khôi phục sau sự cố
      const ended = row.status === 'RUNNING';
      const exam = ended
        ? await tx.exam.update({
            where: { id: examId },
            data: { status: 'ENDED' },
          })
        : row;
      return { exam: toExam(exam), submissions, ended };
    });
  }
}
