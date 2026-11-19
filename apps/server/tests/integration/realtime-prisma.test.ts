import { randomBytes, randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { RealtimeRepository } from '../../src/modules/realtime/services/repository.js';

describe.skipIf(!process.env.AUTH_DATABASE_URL)(
  'Realtime Prisma mapping on the existing PostgreSQL schema',
  () => {
    let prisma: PrismaClient;
    let repository: RealtimeRepository;
    beforeAll(() => {
      prisma = new PrismaClient({
        datasources: { db: { url: process.env.AUTH_DATABASE_URL! } },
      });
      repository = new RealtimeRepository(prisma);
    });
    afterAll(async () => prisma.$disconnect());

    it('keeps exam, monitoring, submission, and recovery behavior', async () => {
      const teacherId = randomUUID();
      const studentId = randomUUID();
      const questionId = randomUUID();
      const correctId = randomUUID();
      const incorrectId = randomUUID();
      const examId = randomUUID();
      const attemptId = randomUUID();
      const autoAttemptId = randomUUID();
      const recoveryAttemptId = randomUUID();
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
      const roomCode = [...randomBytes(6)]
        .map((byte) => alphabet[byte % alphabet.length])
        .join('');
      const teacher = {
        userId: teacherId,
        role: 'TEACHER' as const,
        sid: 'teacher',
      };
      const student = {
        userId: studentId,
        role: 'STUDENT' as const,
        sid: 'student',
      };

      try {
        await prisma.user.create({
          data: {
            id: teacherId,
            email: `${teacherId}@example.test`,
            passwordHash: 'test',
            name: 'Teacher',
            role: 'TEACHER',
          },
        });
        await prisma.user.create({
          data: {
            id: studentId,
            email: `${studentId}@example.test`,
            passwordHash: 'test',
            name: 'Student',
            role: 'STUDENT',
          },
        });
        await prisma.question.create({
          data: {
            id: questionId,
            ownerId: teacherId,
            type: 'SINGLE',
            content: 'Prisma mapping?',
          },
        });
        await prisma.option.createMany({
          data: [
            {
              id: correctId,
              questionId,
              content: 'Yes',
              isCorrect: true,
              orderIndex: 0,
            },
            {
              id: incorrectId,
              questionId,
              content: 'No',
              isCorrect: false,
              orderIndex: 1,
            },
          ],
        });
        await prisma.exam.create({
          data: {
            id: examId,
            ownerId: teacherId,
            title: 'Realtime Prisma test',
            roomCode,
            durationSec: 60,
          },
        });
        expect((await repository.examByCode(roomCode)).id).toBe(examId);
        await repository.canJoin(
          await repository.exam(examId),
          student,
          roomCode,
        );
        await expect(repository.start(examId, teacher)).rejects.toMatchObject({
          code: 'INVALID_STATE',
        });
        await prisma.examQuestion.create({
          data: { examId, questionId, orderIndex: 0, points: 2.5 },
        });
        await expect(repository.start(examId, teacher)).rejects.toMatchObject({
          code: 'INVALID_STATE',
        });
        expect(
          (await prisma.exam.findUniqueOrThrow({ where: { id: examId } }))
            .status,
        ).toBe('DRAFT');
        await prisma.exam.update({
          where: { id: examId },
          data: { status: 'SCHEDULED' },
        });
        await expect(repository.start(examId, student)).rejects.toMatchObject({
          code: 'FORBIDDEN',
        });
        const startResults = await Promise.allSettled([
          repository.start(examId, teacher),
          repository.start(examId, teacher),
        ]);
        const started = startResults.find(
          (
            result,
          ): result is PromiseFulfilledResult<
            Awaited<ReturnType<typeof repository.start>>
          > => result.status === 'fulfilled',
        )?.value;
        expect(
          startResults.filter((result) => result.status === 'fulfilled'),
        ).toHaveLength(1);
        expect(started).toBeDefined();
        if (!started) throw new Error('Exam did not start');
        expect(started.status).toBe('RUNNING');
        expect(
          started.end_time!.getTime() - started.start_time!.getTime(),
        ).toBe(60_000);
        await expect(repository.start(examId, teacher)).rejects.toMatchObject({
          code: 'INVALID_STATE',
        });
        const extended = await repository.extend(examId, 30, teacher);
        expect(extended.end_time!.getTime() - started.end_time!.getTime()).toBe(
          30_000,
        );

        await prisma.attempt.create({
          data: { id: attemptId, examId, userId: studentId },
        });
        await prisma.answer.create({ data: { attemptId, examId, questionId } });
        await prisma.answerSelectedOption.create({
          data: { attemptId, questionId, optionId: correctId },
        });
        await repository.canJoin(extended, student);
        expect(await repository.monitor(examId)).toEqual([attemptId]);
        const state = await repository.attemptState(attemptId, student);
        expect(state.answers).toEqual([{ questionId, optionIds: [correctId] }]);
        expect(state.clock.endTime).toBe(extended.end_time!.toISOString());
        expect(
          (await repository.activeAttempt(attemptId, student)).exam_id,
        ).toBe(examId);
        const at = await repository.recordViolation(
          attemptId,
          student,
          'TAB_BLUR',
          null,
        );
        expect(new Date(at).getTime()).toBeGreaterThan(0);
        expect(await repository.studentUpdate(attemptId)).toMatchObject({
          examId,
          userId: studentId,
          answeredCount: 1,
          violationCount: 1,
          lastViolation: { type: 'TAB_BLUR' },
        });

        await expect(
          repository.forceSubmit(attemptId, student),
        ).rejects.toMatchObject({ code: 'FORBIDDEN' });
        const forcedCalls = await Promise.all([
          repository.forceSubmit(attemptId, teacher),
          repository.forceSubmit(attemptId, teacher),
        ]);
        expect(forcedCalls.filter(Boolean)).toHaveLength(1);
        const forced = forcedCalls.find(Boolean);
        expect(forced).toMatchObject({
          examId,
          attemptId,
          status: 'FORCE_SUBMITTED',
        });
        expect(await repository.forceSubmit(attemptId, teacher)).toBeNull();
        const graded = await prisma.attempt.findUniqueOrThrow({
          where: { id: attemptId },
        });
        expect(Number(graded.score)).toBe(2.5);
        expect(Number(graded.maxScore)).toBe(2.5);

        await prisma.attempt.create({
          data: { id: autoAttemptId, examId, userId: studentId },
        });
        await prisma.exam.update({
          where: { id: examId },
          data: {
            startTime: new Date(Date.now() - 120_000),
            endTime: new Date(Date.now() - 10_000),
          },
        });
        const finished = await repository.finishExpired(examId);
        expect(finished).toMatchObject({
          ended: true,
          exam: { status: 'ENDED' },
        });
        expect(finished?.submissions).toMatchObject([
          { attemptId: autoAttemptId, status: 'AUTO_SUBMITTED' },
        ]);

        await prisma.attempt.create({
          data: { id: recoveryAttemptId, examId, userId: studentId },
        });
        expect(
          (await repository.unfinishedEndedExams()).some(
            (exam) => exam.id === examId,
          ),
        ).toBe(true);
        const recovered = await repository.finishExpired(examId);
        expect(recovered?.ended).toBe(false);
        expect(recovered?.submissions).toMatchObject([
          { attemptId: recoveryAttemptId, status: 'AUTO_SUBMITTED' },
        ]);
      } finally {
        const attemptIds = [attemptId, autoAttemptId, recoveryAttemptId];
        await prisma.answerSelectedOption.deleteMany({
          where: { attemptId: { in: attemptIds } },
        });
        await prisma.answer.deleteMany({
          where: { attemptId: { in: attemptIds } },
        });
        await prisma.proctorLog.deleteMany({
          where: { attemptId: { in: attemptIds } },
        });
        await prisma.attempt.deleteMany({ where: { id: { in: attemptIds } } });
        await prisma.examQuestion.deleteMany({ where: { examId } });
        await prisma.exam.deleteMany({ where: { id: examId } });
        await prisma.option.deleteMany({ where: { questionId } });
        await prisma.question.deleteMany({ where: { id: questionId } });
        await prisma.user.deleteMany({
          where: { id: { in: [teacherId, studentId] } },
        });
      }
    });
  },
);
