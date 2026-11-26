import type { PrismaClient } from '@prisma/client';
import { expect, it, vi } from 'vitest';
import { RealtimeRepository } from '../../src/modules/realtime/services/repository.js';

it('starts only a scheduled exam with questions', async () => {
  const exam = {
    id: 'exam-id',
    ownerId: 'teacher-id',
    roomCode: 'ABC234',
    status: 'DRAFT',
    startTime: null as Date | null,
    endTime: null as Date | null,
    durationSec: 60,
  };
  let questionCount = 1;
  const updateMany = vi.fn(
    async ({
      where,
      data,
    }: {
      where: { status: string };
      data: { status: string; startTime: Date; endTime: Date };
    }) => {
      if (where.status !== exam.status) return { count: 0 };
      Object.assign(exam, data);
      return { count: 1 };
    },
  );
  const tx = {
    exam: {
      findUnique: async () => ({
        ...exam,
        _count: { questions: questionCount },
      }),
      findUniqueOrThrow: async () => exam,
      updateMany,
    },
    $queryRaw: async () => [{ now: new Date('2026-01-01T00:00:00.000Z') }],
  };
  const prisma = {
    $transaction: async (work: (client: typeof tx) => Promise<unknown>) =>
      work(tx),
  } as unknown as PrismaClient;
  const repository = new RealtimeRepository(prisma);
  const teacher = {
    userId: exam.ownerId,
    role: 'TEACHER' as const,
    sid: 'teacher',
  };

  await expect(repository.start(exam.id, teacher)).rejects.toMatchObject({
    code: 'INVALID_STATE',
  });
  expect(exam.status).toBe('DRAFT');
  expect(updateMany).not.toHaveBeenCalled();

  exam.status = 'SCHEDULED';
  questionCount = 0;
  await expect(repository.start(exam.id, teacher)).rejects.toMatchObject({
    code: 'INVALID_STATE',
  });
  expect(exam.status).toBe('SCHEDULED');
  expect(updateMany).not.toHaveBeenCalled();

  questionCount = 1;
  const started = await repository.start(exam.id, teacher);
  expect(started.status).toBe('RUNNING');
  expect(started.end_time!.getTime() - started.start_time!.getTime()).toBe(
    60_000,
  );
  expect(updateMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: expect.objectContaining({ status: 'SCHEDULED' }),
    }),
  );
});
