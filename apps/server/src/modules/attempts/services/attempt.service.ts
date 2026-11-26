import { createHash, randomBytes } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { ERROR_CODES } from '@online-exam/shared';
import { databaseNow } from '../../../core/db/clock.js';
import { lockAttempt } from '../../../core/db/locks.js';
import { HttpError } from '../../../core/errors/http-error.js';
import type { Submitted } from '../../../shared/realtime.js';
import { gradeAttempt, loadGradingQuestions } from './grading.js';

type Tx = Prisma.TransactionClient;

const SUBMIT_GRACE_MS = 5_000;

const attemptNotFound = () =>
  new HttpError(404, ERROR_CODES.NOT_FOUND, 'Attempt not found');
const alreadySubmitted = () =>
  new HttpError(
    409,
    ERROR_CODES.ATTEMPT_ALREADY_SUBMITTED,
    'Attempt is already submitted',
  );

// Same order for the same seed, independent of how rows come back.
function shuffle<T>(items: T[], seed: string, key: (item: T) => string) {
  const rank = (item: T) =>
    createHash('sha256')
      .update(`${seed}:${key(item)}`)
      .digest('hex');
  return items
    .map((item) => ({ item, rank: rank(item) }))
    .sort((a, b) => (a.rank < b.rank ? -1 : a.rank > b.rank ? 1 : 0))
    .map(({ item }) => item);
}

/** The paper a student sees: never isCorrect or explanation. */
async function loadPaper(tx: Tx, attemptId: string) {
  const attempt = await tx.attempt.findUniqueOrThrow({
    where: { id: attemptId },
    include: {
      exam: {
        include: {
          questions: {
            orderBy: { orderIndex: 'asc' },
            select: {
              points: true,
              question: {
                select: {
                  id: true,
                  type: true,
                  content: true,
                  options: {
                    orderBy: { orderIndex: 'asc' },
                    select: { id: true, content: true },
                  },
                },
              },
            },
          },
        },
      },
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
  const { exam } = attempt;
  const seed = attempt.shuffleSeed ?? attempt.id;
  const questions = exam.questions.map((eq) => ({
    questionId: eq.question.id,
    type: eq.question.type,
    content: eq.question.content,
    points: eq.points.toNumber(),
    options: exam.shuffleOptions
      ? shuffle(eq.question.options, `${seed}:${eq.question.id}`, (o) => o.id)
      : eq.question.options,
  }));
  return {
    attemptId: attempt.id,
    examId: attempt.examId,
    status: attempt.status,
    startedAt: attempt.startedAt,
    endTime: exam.endTime,
    serverTime: new Date(),
    questions: exam.shuffleQuestions
      ? shuffle(questions, seed, (q) => q.questionId)
      : questions,
    answers: attempt.answers.map((answer) => ({
      questionId: answer.questionId,
      selectedOptionIds: answer.selectedOptions.map((s) => s.optionId),
      updatedAt: answer.updatedAt,
    })),
  };
}

/**
 * Starts an attempt, or returns the one in progress (same shuffle) when the
 * student reloads. The exam row is locked FOR SHARE so it cannot end or be
 * deleted between the checks and the insert (the worker locks it FOR UPDATE).
 */
export async function startAttempt(
  prisma: PrismaClient,
  userId: string,
  examId: string,
) {
  // Two concurrent starts both pass the checks; the partial unique index on
  // IN_PROGRESS attempts rejects one, whose retry then finds the winner.
  // The active attempt and the count come from one query: read separately,
  // a winner committing in between made the loser see no attempts left.
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const [exam] = await tx.$queryRaw<
          {
            status: string;
            end_time: Date | null;
            max_attempts: number;
            now: Date;
          }[]
        >`
          SELECT status, end_time, max_attempts, now() AS now FROM exams
          WHERE id = ${examId}::uuid
          FOR SHARE`;
        if (!exam || exam.status === 'DRAFT') {
          throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Exam not found');
        }
        const attempts = await tx.attempt.findMany({
          where: { examId, userId },
          select: { id: true, status: true },
        });
        const active = attempts.find((a) => a.status === 'IN_PROGRESS');
        if (active)
          return { created: false, paper: await loadPaper(tx, active.id) };
        if (exam.status === 'SCHEDULED') {
          throw new HttpError(
            422,
            ERROR_CODES.EXAM_NOT_STARTED,
            'Exam has not started',
          );
        }
        if (
          exam.status === 'ENDED' ||
          !exam.end_time ||
          exam.end_time < exam.now
        ) {
          throw new HttpError(422, ERROR_CODES.EXAM_ENDED, 'Exam has ended');
        }
        if (attempts.length >= exam.max_attempts) {
          throw new HttpError(
            409,
            ERROR_CODES.ATTEMPT_LIMIT_REACHED,
            'No attempts left',
          );
        }
        const created = await tx.attempt.create({
          data: {
            examId,
            userId,
            shuffleSeed: randomBytes(16).toString('hex'),
          },
          select: { id: true },
        });
        return { created: true, paper: await loadPaper(tx, created.id) };
      });
    } catch (error) {
      const clash =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002';
      if (!clash || attempt === 2) throw error;
    }
  }
}

/**
 * Loads the student's attempt with its row locked FOR UPDATE: autosave and
 * submit (REST, force or auto) run one at a time, so no answer lands after
 * grading.
 */
async function lockOwnAttempt(tx: Tx, userId: string, attemptId: string) {
  await lockAttempt(tx, attemptId);
  const attempt = await tx.attempt.findUnique({
    where: { id: attemptId },
    include: { exam: { select: { endTime: true } } },
  });
  if (!attempt || attempt.userId !== userId) throw attemptNotFound();
  if (attempt.status !== 'IN_PROGRESS') throw alreadySubmitted();
  return attempt;
}

/** Replaces the answer to one question; an empty list clears it. */
export async function saveAnswer(
  prisma: PrismaClient,
  userId: string,
  attemptId: string,
  questionId: string,
  selectedOptionIds: string[],
) {
  return prisma.$transaction(async (tx) => {
    const attempt = await lockOwnAttempt(tx, userId, attemptId);
    const now = await databaseNow(tx);
    if (!attempt.exam.endTime || now > attempt.exam.endTime) {
      throw new HttpError(422, ERROR_CODES.EXAM_ENDED, 'Exam has ended');
    }
    const examQuestion = await tx.examQuestion.findUnique({
      where: { examId_questionId: { examId: attempt.examId, questionId } },
      select: {
        question: { select: { type: true, options: { select: { id: true } } } },
      },
    });
    if (!examQuestion) {
      throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Question not found');
    }
    const { type, options } = examQuestion.question;
    const known = new Set(options.map((o) => o.id));
    const details = selectedOptionIds.flatMap((id, i) =>
      known.has(id)
        ? []
        : [{ field: `selectedOptionIds.${i}`, issue: 'Option not found' }],
    );
    if (type !== 'MULTIPLE' && selectedOptionIds.length > 1) {
      details.push({
        field: 'selectedOptionIds',
        issue: 'Only one option can be selected',
      });
    }
    if (details.length > 0) {
      throw new HttpError(
        400,
        ERROR_CODES.VALIDATION_FAILED,
        'Invalid answer',
        details,
      );
    }

    const key = { attemptId_questionId: { attemptId, questionId } };
    if (selectedOptionIds.length === 0) {
      // No row means unanswered, so the monitor's answeredCount drops.
      await tx.answer.deleteMany({ where: { attemptId, questionId } });
    } else {
      await tx.answer.upsert({
        where: key,
        create: {
          attemptId,
          examId: attempt.examId,
          questionId,
          updatedAt: now,
        },
        update: { updatedAt: now },
      });
      await tx.answerSelectedOption.deleteMany({
        where: { attemptId, questionId },
      });
      await tx.answerSelectedOption.createMany({
        data: selectedOptionIds.map((optionId) => ({
          attemptId,
          questionId,
          optionId,
        })),
      });
    }
    return { questionId, selectedOptionIds, updatedAt: now };
  });
}

/** Grades and submits; accepted until endTime + 5 seconds. */
export async function submitAttempt(
  prisma: PrismaClient,
  userId: string,
  attemptId: string,
) {
  return prisma.$transaction(async (tx) => {
    const attempt = await lockOwnAttempt(tx, userId, attemptId);
    const now = await databaseNow(tx);
    const endTime = attempt.exam.endTime;
    if (!endTime || now.getTime() > endTime.getTime() + SUBMIT_GRACE_MS) {
      throw new HttpError(
        422,
        ERROR_CODES.SUBMIT_TOO_LATE,
        'The submission window has closed',
      );
    }
    const { score, maxScore } = gradeAttempt(
      await loadGradingQuestions(tx, attemptId, attempt.examId),
    );
    const row = await tx.attempt.update({
      where: { id: attemptId },
      data: { status: 'SUBMITTED', submittedAt: now, score, maxScore },
      include: {
        user: { select: { id: true, name: true, email: true } },
        _count: { select: { answers: true, proctorLogs: true } },
      },
    });
    const submitted: Submitted = {
      examId: row.examId,
      attemptId: row.id,
      userId: row.userId,
      status: 'SUBMITTED',
      submittedAt: now.toISOString(),
    };
    return {
      submitted,
      summary: {
        attemptId: row.id,
        examId: row.examId,
        user: row.user,
        status: row.status,
        startedAt: row.startedAt,
        submittedAt: row.submittedAt,
        score: row.score?.toNumber() ?? null,
        maxScore: row.maxScore?.toNumber() ?? null,
        answeredCount: row._count.answers,
        violationCount: row._count.proctorLogs,
      },
    };
  });
}
