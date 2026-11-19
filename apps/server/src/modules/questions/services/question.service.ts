import { Prisma, type PrismaClient } from '@prisma/client';
import { ERROR_CODES, type QuestionInput } from '@online-exam/shared';
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
  prisma: PrismaClient,
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

export async function getQuestion(
  prisma: PrismaClient,
  ownerId: string,
  id: string,
) {
  const row = await prisma.question.findFirst({
    where: { id, ownerId },
    include,
  });
  if (!row) throw notFound();
  return toDto(row);
}

export async function createQuestion(
  prisma: PrismaClient,
  ownerId: string,
  input: QuestionInput,
) {
  const row = await prisma.question.create({
    data: { ownerId, ...fields(input), options: { create: optionRows(input) } },
    include,
  });
  return toDto(row);
}

export async function updateQuestion(
  prisma: PrismaClient,
  ownerId: string,
  id: string,
  input: QuestionInput,
) {
  return prisma.$transaction(async (tx) => {
    // Lock the question before checking whether it is in use. Publishing an
    // exam locks its questions FOR SHARE (docs/api-contract.md), so the two
    // run one after the other: a publish that commits first is seen by the
    // check below, and a publish that comes second waits for this edit.
    const locked = await tx.$queryRaw<unknown[]>`
      SELECT id FROM questions
      WHERE id = ${id}::uuid AND owner_id = ${ownerId}::uuid
      FOR UPDATE`;
    if (locked.length === 0) throw notFound();
    const current = await tx.question.findFirstOrThrow({
      where: { id },
      include,
    });
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

export async function deleteQuestion(
  prisma: PrismaClient,
  ownerId: string,
  id: string,
) {
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
