import { randomInt } from 'node:crypto';
import { Prisma, type PrismaClient } from '@prisma/client';
import { ERROR_CODES, type ExamInput } from '@online-exam/shared';
import { HttpError } from '../../../core/errors/http-error.js';
import {
  questionInclude,
  toQuestionDto,
} from '../../questions/services/question.service.js';
import type { ListExamsQuery } from '../dto/exam.dto.js';

const summaryInclude = {
  questions: { select: { points: true } },
} satisfies Prisma.ExamInclude;
const detailInclude = {
  questions: {
    orderBy: { orderIndex: 'asc' },
    include: { question: { include: questionInclude } },
  },
} satisfies Prisma.ExamInclude;
type DetailRow = Prisma.ExamGetPayload<{ include: typeof detailInclude }>;

const notFound = () =>
  new HttpError(404, ERROR_CODES.NOT_FOUND, 'Exam not found');
const notEditable = () =>
  new HttpError(409, ERROR_CODES.EXAM_NOT_EDITABLE, 'Exam is not a draft');

function toExamDto(
  e: Prisma.ExamGetPayload<{ include: typeof summaryInclude }>,
) {
  return {
    id: e.id,
    title: e.title,
    roomCode: e.roomCode,
    durationSec: e.durationSec,
    status: e.status,
    startTime: e.startTime,
    endTime: e.endTime,
    shuffleQuestions: e.shuffleQuestions,
    shuffleOptions: e.shuffleOptions,
    maxAttempts: e.maxAttempts,
    questionCount: e.questions.length,
    // Summed in hundredths so decimal points add up exactly.
    totalPoints:
      e.questions.reduce(
        (sum, q) => sum + Math.round(q.points.toNumber() * 100),
        0,
      ) / 100,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

function toExamDetailDto(e: DetailRow) {
  return {
    ...toExamDto(e),
    questions: e.questions.map((q) => ({
      points: q.points.toNumber(),
      question: toQuestionDto(q.question),
    })),
  };
}

// RoomCode alphabet: A-Z and 2-9 without the look-alikes 0, O, 1, I.
const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newRoomCode = () =>
  Array.from(
    { length: 6 },
    () => ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)],
  ).join('');

const examFields = (input: ExamInput) => ({
  title: input.title,
  durationSec: input.durationSec,
  shuffleQuestions: input.shuffleQuestions,
  shuffleOptions: input.shuffleOptions,
  maxAttempts: input.maxAttempts,
});
const questionRows = (input: ExamInput) =>
  input.questions.map((q, orderIndex) => ({
    questionId: q.questionId,
    orderIndex,
    points: q.points,
  }));

/**
 * Checks that the chosen questions exist and belong to the teacher, and
 * locks them FOR SHARE until the transaction that links them commits. A
 * concurrent delete then either finishes first (reported here as an unknown
 * question) or waits and finds the question in use (409 QUESTION_IN_USE).
 */
async function lockOwnQuestions(
  tx: Prisma.TransactionClient,
  ownerId: string,
  input: ExamInput,
) {
  const ids = input.questions.map((q) => q.questionId);
  if (ids.length === 0) return;
  const owned = new Set(
    (
      await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM questions
        WHERE id = ANY(${ids}::uuid[]) AND owner_id = ${ownerId}::uuid
        ORDER BY id
        FOR SHARE`
    ).map((q) => q.id),
  );
  const details = input.questions.flatMap((q, i) =>
    owned.has(q.questionId)
      ? []
      : [{ field: `questions.${i}.questionId`, issue: 'Question not found' }],
  );
  if (details.length > 0) {
    throw new HttpError(
      400,
      ERROR_CODES.VALIDATION_FAILED,
      'Unknown questions',
      details,
    );
  }
}

/** Locks the exam row so edit, delete and publish run one at a time. */
async function lockDraft(
  tx: Prisma.TransactionClient,
  ownerId: string,
  id: string,
) {
  const [exam] = await tx.$queryRaw<{ status: string }[]>`
    SELECT status FROM exams
    WHERE id = ${id}::uuid AND owner_id = ${ownerId}::uuid
    FOR UPDATE`;
  if (!exam) throw notFound();
  if (exam.status !== 'DRAFT') throw notEditable();
}

export async function listExams(
  prisma: PrismaClient,
  ownerId: string,
  { page, pageSize, sort, status }: ListExamsQuery,
) {
  const where: Prisma.ExamWhereInput = { ownerId, status };
  const orderBy: Prisma.ExamOrderByWithRelationInput =
    sort === 'startTime:desc'
      ? { startTime: { sort: 'desc', nulls: 'last' } }
      : { createdAt: sort === 'createdAt:asc' ? 'asc' : 'desc' };
  const [rows, total] = await prisma.$transaction([
    prisma.exam.findMany({
      where,
      include: summaryInclude,
      orderBy: [orderBy, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.exam.count({ where }),
  ]);
  return { data: rows.map(toExamDto), meta: { page, pageSize, total } };
}

export async function getExam(
  prisma: PrismaClient,
  ownerId: string,
  id: string,
) {
  const row = await prisma.exam.findFirst({
    where: { id, ownerId },
    include: detailInclude,
  });
  if (!row) throw notFound();
  return toExamDetailDto(row);
}

export async function createExam(
  prisma: PrismaClient,
  ownerId: string,
  input: ExamInput,
) {
  // 32^6 codes: a clash is rare, so retry a few times on the unique index.
  for (let attempt = 1; ; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        await lockOwnQuestions(tx, ownerId, input);
        const row = await tx.exam.create({
          data: {
            ownerId,
            roomCode: newRoomCode(),
            ...examFields(input),
            questions: { create: questionRows(input) },
          },
          include: detailInclude,
        });
        return toExamDetailDto(row);
      });
    } catch (error) {
      const clash =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002';
      if (!clash || attempt === 5) throw error;
    }
  }
}

export async function updateExam(
  prisma: PrismaClient,
  ownerId: string,
  id: string,
  input: ExamInput,
) {
  return prisma.$transaction(async (tx) => {
    // Same order as publish (exam, then its questions): no deadlock.
    await lockDraft(tx, ownerId, id);
    await lockOwnQuestions(tx, ownerId, input);
    await tx.examQuestion.deleteMany({ where: { examId: id } });
    const row = await tx.exam.update({
      where: { id },
      data: {
        ...examFields(input),
        questions: { create: questionRows(input) },
      },
      include: detailInclude,
    });
    return toExamDetailDto(row);
  });
}

export async function deleteExam(
  prisma: PrismaClient,
  ownerId: string,
  id: string,
) {
  await prisma.$transaction(async (tx) => {
    await lockDraft(tx, ownerId, id);
    await tx.exam.delete({ where: { id } });
  });
}

export async function publishExam(
  prisma: PrismaClient,
  ownerId: string,
  id: string,
) {
  return prisma.$transaction(async (tx) => {
    await lockDraft(tx, ownerId, id);
    // docs/api-contract.md: lock the exam's questions FOR SHARE before
    // leaving DRAFT. A question edit holding FOR UPDATE finishes first;
    // one that comes later waits and then sees the exam published (409).
    const locked = await tx.$queryRaw<unknown[]>`
      SELECT q.id FROM questions q
      JOIN exam_questions eq ON eq.question_id = q.id
      WHERE eq.exam_id = ${id}::uuid
      ORDER BY q.id
      FOR SHARE OF q`;
    if (locked.length === 0) {
      throw new HttpError(
        422,
        ERROR_CODES.VALIDATION_FAILED,
        'An exam needs at least one question before publishing',
        [{ field: 'questions', issue: 'At least one question is required' }],
      );
    }
    const row = await tx.exam.update({
      where: { id },
      data: { status: 'SCHEDULED' },
      include: detailInclude,
    });
    return toExamDetailDto(row);
  });
}

export async function joinExam(
  prisma: PrismaClient,
  userId: string,
  roomCode: string,
) {
  const exam = await prisma.exam.findUnique({
    where: { roomCode },
    include: { _count: { select: { questions: true } } },
  });
  // A DRAFT exam is not open yet: treat it as an unknown room.
  if (!exam || exam.status === 'DRAFT') {
    throw new HttpError(404, ERROR_CODES.ROOM_NOT_FOUND, 'Room not found');
  }
  if (exam.status === 'ENDED') {
    throw new HttpError(422, ERROR_CODES.EXAM_ENDED, 'Exam has ended');
  }
  const attempts = await prisma.attempt.findMany({
    where: { examId: exam.id, userId },
    select: { id: true, status: true },
  });
  return {
    examId: exam.id,
    title: exam.title,
    status: exam.status,
    durationSec: exam.durationSec,
    questionCount: exam._count.questions,
    startTime: exam.startTime,
    endTime: exam.endTime,
    serverTime: new Date(),
    maxAttempts: exam.maxAttempts,
    attemptsUsed: attempts.length,
    activeAttemptId:
      attempts.find((a) => a.status === 'IN_PROGRESS')?.id ?? null,
  };
}
