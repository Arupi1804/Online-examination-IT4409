import { Prisma } from '@prisma/client';
import { ERROR_CODES, type QuestionInput } from '@online-exam/shared';
import { prisma } from '../../../core/prisma.js';
import { HttpError } from '../../../core/errors/http-error.js';
import type { ListQuestionsQuery } from '../dto/question.dto.js';

// `examQuestions` here only holds exams past DRAFT: non-empty means locked.
const include = {
  options: { orderBy: { orderIndex: 'asc' } },
  examQuestions: {
    where: { exam: { status: { not: 'DRAFT' } } },
    select: { examId: true },
    take: 1,
  },
} satisfies Prisma.QuestionInclude;
type QuestionRow = Prisma.QuestionGetPayload<{ include: typeof include }>;

const notFound = () =>
  new HttpError(404, ERROR_CODES.NOT_FOUND, 'Question not found');
const inUse = () =>
  new HttpError(
    409,
    ERROR_CODES.QUESTION_IN_USE,
    'Question is used in an exam',
  );

function toDto(q: QuestionRow) {
  return {
    id: q.id,
    type: q.type,
    content: q.content,
    explanation: q.explanation,
    options: q.options.map(({ id, content, isCorrect }) => ({
      id,
      content,
      isCorrect,
    })),
    inUse: q.examQuestions.length > 0,
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
  };
}

const fields = (input: QuestionInput) => ({
  type: input.type,
  content: input.content,
  explanation: input.explanation ?? null,
});
const optionRows = (input: QuestionInput) =>
  input.options.map((o, orderIndex) => ({ ...o, orderIndex }));

export async function listQuestions(
  ownerId: string,
  { page, pageSize, sort, type, q }: ListQuestionsQuery,
) {
  const where: Prisma.QuestionWhereInput = {
    ownerId,
    type,
    ...(q && { content: { contains: q, mode: 'insensitive' } }),
  };
  const [field, direction] = sort.split(':') as [
    'createdAt' | 'updatedAt',
    Prisma.SortOrder,
  ];
  const [rows, total] = await prisma.$transaction([
    prisma.question.findMany({
      where,
      include,
      orderBy: [{ [field]: direction }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.question.count({ where }),
  ]);
  return { data: rows.map(toDto), meta: { page, pageSize, total } };
}

export async function getQuestion(ownerId: string, id: string) {
  const row = await prisma.question.findFirst({
    where: { id, ownerId },
    include,
  });
  if (!row) throw notFound();
  return toDto(row);
}

export async function createQuestion(ownerId: string, input: QuestionInput) {
  const row = await prisma.question.create({
    data: { ownerId, ...fields(input), options: { create: optionRows(input) } },
    include,
  });
  return toDto(row);
}

export async function updateQuestion(
  ownerId: string,
  id: string,
  input: QuestionInput,
) {
  // ponytail: check-then-write without a row lock; an exam published in the
  // same instant can slip through. Lock the question row if that matters.
  return prisma.$transaction(async (tx) => {
    const current = await tx.question.findFirst({
      where: { id, ownerId },
      include,
    });
    if (!current) throw notFound();
    if (current.examQuestions.length > 0) throw inUse();
    // Delete first: new options reuse the (question_id, order_index) slots.
    await tx.option.deleteMany({ where: { questionId: id } });
    const row = await tx.question.update({
      where: { id },
      data: { ...fields(input), options: { create: optionRows(input) } },
      include,
    });
    return toDto(row);
  });
}

export async function deleteQuestion(ownerId: string, id: string) {
  const current = await prisma.question.findFirst({
    where: { id, ownerId },
    select: { _count: { select: { examQuestions: true } } },
  });
  if (!current) throw notFound();
  // Any exam, even DRAFT, blocks deletion; exam_questions has no cascade.
  if (current._count.examQuestions > 0) throw inUse();
  try {
    await prisma.question.delete({ where: { id } });
  } catch (error) {
    // Added to an exam after the check above: the foreign key refuses.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2003'
    ) {
      throw inUse();
    }
    throw error;
  }
}
