/* PostgreSQL remains authoritative; Prisma owns all realtime data operations. */

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

function toAttempt(row: PrismaAttempt): Attempt {
  return {
    id: row.id,
    exam_id: row.examId,
    user_id: row.userId,
    status: row.status as AttemptStatus,
    submitted_at: row.submittedAt,
  };
}

export function clock(exam: Exam): ExamClock {
  return {
    examId: exam.id,
    status: exam.status,
    startTime: exam.start_time?.toISOString() ?? null,
    endTime: exam.end_time?.toISOString() ?? null,
    serverTime: new Date().toISOString(),
  };
}

export class RealtimeRepository {
  constructor(private readonly prisma: PrismaClient) {}

  // Retry serialization conflicts so concurrent requests retain the old
  // row-lock behavior: one transition wins and the other observes its result.
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
        if (!isRetryableTransactionError(error) || attempt === 2) throw error;
        await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
      }
    }
    throw new Error('Unreachable transaction state');
  }

  async exam(examId: string): Promise<Exam> {
    const row = await this.prisma.exam.findUnique({ where: { id: examId } });
    if (!row) throw new RealtimeError('NOT_FOUND', 'Exam not found');
    return toExam(row);
  }

  async examByCode(code: string): Promise<Exam> {
    const row = await this.prisma.exam.findUnique({
      where: { roomCode: code },
    });
    if (!row) throw new RealtimeError('NOT_FOUND', 'Exam not found');
    return toExam(row);
  }

  async canJoin(
    exam: Exam,
    principal: Principal,
    roomCode?: string,
  ): Promise<void> {
    if (
      principal.role === 'ADMIN' ||
      (principal.role === 'TEACHER' && exam.owner_id === principal.userId)
    )
      return;
    if (principal.role !== 'STUDENT')
      throw new RealtimeError('FORBIDDEN', 'Exam access denied');
    if (roomCode === exam.room_code) return;
    const attempt = await this.prisma.attempt.findFirst({
      where: { examId: exam.id, userId: principal.userId },
      select: { id: true },
    });
    if (!attempt) throw new RealtimeError('FORBIDDEN', 'Exam access denied');
  }

  assertTeacher(exam: Exam, principal: Principal): void {
    if (principal.role !== 'TEACHER' || exam.owner_id !== principal.userId)
      throw new RealtimeError('FORBIDDEN', 'Teacher does not own exam');
  }

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
      const now = await databaseNow(tx);
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

  async extend(
    examId: string,
    seconds: number,
    principal: Principal,
  ): Promise<Exam> {
    return this.serializable(async (tx) => {
      const current = await tx.exam.findUnique({ where: { id: examId } });
      if (!current) throw new RealtimeError('NOT_FOUND', 'Exam not found');
      this.assertTeacher(toExam(current), principal);
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

  async attemptState(
    attemptId: string,
    principal: Principal,
  ): Promise<AttemptState> {
    const row = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: {
        exam: true,
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

  async monitor(examId: string): Promise<string[]> {
    const rows = await this.prisma.attempt.findMany({
      where: { examId },
      orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    return rows.map((row) => row.id);
  }

  async runningExams(): Promise<Exam[]> {
    const rows = await this.prisma.exam.findMany({
      where: { status: 'RUNNING' },
    });
    return rows.map(toExam);
  }

  async unfinishedEndedExams(): Promise<Exam[]> {
    const rows = await this.prisma.exam.findMany({
      where: { status: 'ENDED', attempts: { some: { status: 'IN_PROGRESS' } } },
    });
    return rows.map(toExam);
  }

  private async grade(
    tx: Prisma.TransactionClient,
    attemptId: string,
    examId: string,
  ): Promise<{ score: number; maxScore: number }> {
    const questions = await tx.examQuestion.findMany({
      where: { examId },
      select: {
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
    let score = 0;
    let maxScore = 0;
    for (const question of questions) {
      const points = Number(question.points);
      maxScore += points;
      const correct = new Set(
        question.question.options.map((option) => option.id),
      );
      const selected = new Set(
        question.answers.flatMap((answer) =>
          answer.selectedOptions.map((selection) => selection.optionId),
        ),
      );
      if (
        correct.size > 0 &&
        correct.size === selected.size &&
        [...correct].every((id) => selected.has(id))
      )
        score += points;
    }
    return {
      score: Math.round(score * 100) / 100,
      maxScore: Math.round(maxScore * 100) / 100,
    };
  }

  private async submitLocked(
    tx: Prisma.TransactionClient,
    attempt: Attempt,
    status: Exclude<AttemptStatus, 'IN_PROGRESS'>,
  ): Promise<Submitted | null> {
    if (attempt.status !== 'IN_PROGRESS') return null;
    const { score, maxScore } = await this.grade(
      tx,
      attempt.id,
      attempt.exam_id,
    );
    const submittedAt = await databaseNow(tx);
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

  async forceSubmit(
    attemptId: string,
    principal: Principal,
  ): Promise<Submitted | null> {
    return this.serializable(async (tx) => {
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

  async finishExpired(
    examId: string,
  ): Promise<{ exam: Exam; submissions: Submitted[]; ended: boolean } | null> {
    return this.serializable(async (tx) => {
      if (!(await lockExpiredExam(tx, examId))) return null;
      const row = await tx.exam.findUnique({ where: { id: examId } });
      if (!row || !['RUNNING', 'ENDED'].includes(row.status)) return null;
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
