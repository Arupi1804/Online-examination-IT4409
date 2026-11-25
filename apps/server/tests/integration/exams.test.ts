import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { createClient } from 'redis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Role } from '@online-exam/shared';
import { createApp } from '../../src/app.js';
import {
  AuthSessions,
  AuthSessionStore,
} from '../../src/modules/auth/index.js';
import { createExamsRouter } from '../../src/modules/exams/controllers/exams.controller.js';
import { waitForLockWait } from './lock-wait.js';

// Uses PostgreSQL with database/init/*.sql applied: CI's service, or locally
// `pnpm infra:up` with the root .env. Skipped when DATABASE_URL is unset.
config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)) });

const origin = 'http://localhost:5173';
// requireRoles only reads req.principal, so this store never touches Redis.
const sessions = new AuthSessions({
  store: new AuthSessionStore(createClient(), 'oe:test:v1'),
  secret: 'exams-test-secret-at-least-32-characters',
  clientOrigin: origin,
  secureCookie: false,
});
let prisma: PrismaClient;

// Stands in for the session middleware: signs the request in as `user`.
function appAs(user?: { id: string; role: Role }) {
  const apiRouter = Router();
  apiRouter.use(
    '/exams',
    createExamsRouter(prisma, {
      teacher: sessions.requireRoles('TEACHER'),
      student: sessions.requireRoles('STUDENT'),
    }),
  );
  return createApp(origin, {
    apiRouter,
    sessionMiddleware: (req, _res, next) => {
      if (user) req.principal = { ...user, userId: user.id, sid: 'test' };
      next();
    },
  });
}

// The ownership check that must wait while a delete holds the question.
const RACE_CREATE_WAIT = 'WHERE id = ANY(';

const examInput = (
  questions: { questionId: string; points: number }[],
  title = 'Kiểm tra 15 phút',
) => ({ title, durationSec: 900, questions });

describe.skipIf(!process.env.DATABASE_URL)('exams API', () => {
  const run = randomUUID().slice(0, 8);
  const ids = { teacher: '', other: '', student: '' };
  const questionIds: string[] = [];
  let foreignQuestion = '';
  let teacher: ReturnType<typeof appAs>;
  let student: ReturnType<typeof appAs>;

  async function newQuestion(ownerId: string, content: string) {
    const q = await prisma.question.create({
      data: {
        ownerId,
        type: 'SINGLE',
        content,
        options: {
          create: [
            { content: 'Đúng', isCorrect: true, orderIndex: 0 },
            { content: 'Sai', isCorrect: false, orderIndex: 1 },
          ],
        },
      },
    });
    return q.id;
  }

  async function newExam(
    questions = [{ questionId: questionIds[0]!, points: 1 }],
  ) {
    const res = await request(teacher)
      .post('/api/v1/exams')
      .send(examInput(questions));
    expect(res.status).toBe(201);
    return res.body.data as { id: string; roomCode: string };
  }

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL } },
    });
    for (const [key, role] of [
      ['teacher', 'TEACHER'],
      ['other', 'TEACHER'],
      ['student', 'STUDENT'],
    ] as const) {
      const user = await prisma.user.create({
        data: {
          email: `exam-${key}-${run}@test.local`,
          passwordHash: 'x',
          name: key,
          role,
        },
      });
      ids[key] = user.id;
    }
    for (const n of [1, 2, 3]) {
      questionIds.push(await newQuestion(ids.teacher, `Câu ${n}`));
    }
    foreignQuestion = await newQuestion(ids.other, 'Câu của người khác');
    teacher = appAs({ id: ids.teacher, role: 'TEACHER' });
    student = appAs({ id: ids.student, role: 'STUDENT' });
  });

  afterAll(async () => {
    const ownerId = { in: [ids.teacher, ids.other] };
    await prisma.attempt.deleteMany({ where: { exam: { ownerId } } });
    await prisma.exam.deleteMany({ where: { ownerId } });
    await prisma.question.deleteMany({ where: { ownerId } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
    await prisma.$disconnect();
  });

  it('lets teachers manage exams and only students join', async () => {
    expect((await request(appAs()).get('/api/v1/exams')).status).toBe(401);
    expect((await request(student).get('/api/v1/exams')).status).toBe(403);
    const join = await request(teacher)
      .post('/api/v1/exams/join')
      .send({ roomCode: 'K7M2QX' });
    expect(join.status).toBe(403);
  });

  it('creates a draft with a generated room code and ordered questions', async () => {
    const res = await request(teacher)
      .post('/api/v1/exams')
      .send(
        examInput([
          { questionId: questionIds[1]!, points: 2.5 },
          { questionId: questionIds[0]!, points: 1 },
        ]),
      );
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      status: 'DRAFT',
      startTime: null,
      shuffleQuestions: false,
      maxAttempts: 1,
      questionCount: 2,
      totalPoints: 3.5,
    });
    expect(res.body.data.roomCode).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
    expect(
      res.body.data.questions.map(
        (q: { points: number; question: { content: string } }) =>
          `${q.question.content}:${q.points}`,
      ),
    ).toEqual(['Câu 2:2.5', 'Câu 1:1']);
    expect(res.body.data.questions[0].question.options[0].isCorrect).toBe(true);

    const empty = await request(teacher)
      .post('/api/v1/exams')
      .send(examInput([]));
    expect(empty.status).toBe(201);
    expect(empty.body.data).toMatchObject({ questionCount: 0, totalPoints: 0 });
  });

  it('rejects foreign or duplicate questions and bad points', async () => {
    const foreign = await request(teacher)
      .post('/api/v1/exams')
      .send(examInput([{ questionId: foreignQuestion, points: 1 }]));
    expect(foreign.status).toBe(400);
    expect(foreign.body.error.details[0].field).toBe('questions.0.questionId');

    const duplicate = await request(teacher)
      .post('/api/v1/exams')
      .send(
        examInput([
          { questionId: questionIds[0]!, points: 1 },
          { questionId: questionIds[0]!, points: 1 },
        ]),
      );
    expect(duplicate.status).toBe(400);

    const decimals = await request(teacher)
      .post('/api/v1/exams')
      .send(examInput([{ questionId: questionIds[0]!, points: 1.234 }]));
    expect(decimals.status).toBe(400);
  });

  it('validates the minimum question points on create and update', async () => {
    const questions = [{ questionId: questionIds[0]!, points: 1e-12 }];
    const invalidPointsError = {
      code: 'VALIDATION_FAILED',
      details: [
        { field: 'questions.0.points', issue: 'Points must be at least 0.01' },
      ],
    };

    const invalidCreate = await request(teacher)
      .post('/api/v1/exams')
      .send(examInput(questions));
    expect(invalidCreate.status).toBe(400);
    expect(invalidCreate.body.error).toMatchObject(invalidPointsError);

    const created = await request(teacher)
      .post('/api/v1/exams')
      .send(examInput([{ questionId: questionIds[0]!, points: 0.01 }]));
    expect(created.status).toBe(201);
    expect(created.body.data.totalPoints).toBe(0.01);

    const invalidUpdate = await request(teacher)
      .put(`/api/v1/exams/${created.body.data.id}`)
      .send(examInput(questions));
    expect(invalidUpdate.status).toBe(400);
    expect(invalidUpdate.body.error).toMatchObject(invalidPointsError);
  });

  it("lists only own exams and hides other teachers' exams", async () => {
    const mine = await newExam();
    const list = await request(teacher).get(
      '/api/v1/exams?status=DRAFT&pageSize=100',
    );
    expect(list.status).toBe(200);
    expect(list.body.meta.total).toBeGreaterThanOrEqual(1);
    expect(
      list.body.data.every((e: { status: string }) => e.status === 'DRAFT'),
    ).toBe(true);

    const other = appAs({ id: ids.other, role: 'TEACHER' });
    expect((await request(other).get('/api/v1/exams')).body.meta.total).toBe(0);
    expect((await request(other).get(`/api/v1/exams/${mine.id}`)).status).toBe(
      404,
    );
    expect(
      (await request(teacher).get('/api/v1/exams/not-a-uuid')).status,
    ).toBe(404);
  });

  it('edits and deletes only drafts', async () => {
    const exam = await newExam();
    const edited = await request(teacher)
      .put(`/api/v1/exams/${exam.id}`)
      .send({
        ...examInput([{ questionId: questionIds[2]!, points: 4 }], 'Đã sửa'),
        shuffleOptions: true,
        maxAttempts: 2,
      });
    expect(edited.status).toBe(200);
    expect(edited.body.data).toMatchObject({
      title: 'Đã sửa',
      roomCode: exam.roomCode,
      shuffleOptions: true,
      maxAttempts: 2,
      totalPoints: 4,
    });
    expect(edited.body.data.questions[0].question.content).toBe('Câu 3');

    expect(
      (await request(teacher).delete(`/api/v1/exams/${exam.id}`)).status,
    ).toBe(204);
    expect(
      (await request(teacher).get(`/api/v1/exams/${exam.id}`)).status,
    ).toBe(404);
  });

  it('publishes a draft with questions and locks it afterwards', async () => {
    const empty = await newExam([]);
    const refused = await request(teacher).post(
      `/api/v1/exams/${empty.id}/publish`,
    );
    expect(refused.status).toBe(422);
    expect(refused.body.error.details[0].field).toBe('questions');
    expect(
      (await request(teacher).get(`/api/v1/exams/${empty.id}`)).body.data
        .status,
    ).toBe('DRAFT');

    const exam = await newExam();
    const published = await request(teacher).post(
      `/api/v1/exams/${exam.id}/publish`,
    );
    expect(published.status).toBe(200);
    expect(published.body.data.status).toBe('SCHEDULED');
    expect(published.body.data.questions[0].question.inUse).toBe(true);

    for (const res of [
      await request(teacher).post(`/api/v1/exams/${exam.id}/publish`),
      await request(teacher)
        .put(`/api/v1/exams/${exam.id}`)
        .send(examInput([])),
      await request(teacher).delete(`/api/v1/exams/${exam.id}`),
    ]) {
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('EXAM_NOT_EDITABLE');
    }
  });

  it('lets students join open rooms by code', async () => {
    expect(
      (
        await request(student)
          .post('/api/v1/exams/join')
          .send({ roomCode: 'abc' })
      ).status,
    ).toBe(400);
    expect(
      await prisma.exam.findUnique({ where: { roomCode: 'ZZZZ22' } }),
    ).toBeNull();
    const unknown = await request(student)
      .post('/api/v1/exams/join')
      .send({ roomCode: 'ZZZZ22' });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('ROOM_NOT_FOUND');
    const draft = await newExam();
    const hidden = await request(student)
      .post('/api/v1/exams/join')
      .send({ roomCode: draft.roomCode });
    expect(hidden.status).toBe(404);
    expect(hidden.body.error.code).toBe('ROOM_NOT_FOUND');

    const exam = await newExam();
    await request(teacher).post(`/api/v1/exams/${exam.id}/publish`);
    const joined = await request(student)
      .post('/api/v1/exams/join')
      .send({ roomCode: exam.roomCode.toLowerCase() });
    expect(joined.status).toBe(200);
    expect(joined.body.data).toMatchObject({
      examId: exam.id,
      status: 'SCHEDULED',
      questionCount: 1,
      attemptsUsed: 0,
      activeAttemptId: null,
    });
    expect(joined.body.data).not.toHaveProperty('questions');

    await prisma.exam.update({
      where: { id: exam.id },
      data: {
        status: 'RUNNING',
        startTime: new Date(),
        endTime: new Date(Date.now() + 900_000),
      },
    });
    const attempt = await prisma.attempt.create({
      data: { examId: exam.id, userId: ids.student },
    });
    const resumed = await request(student)
      .post('/api/v1/exams/join')
      .send({ roomCode: exam.roomCode });
    expect(resumed.body.data).toMatchObject({
      status: 'RUNNING',
      attemptsUsed: 1,
      activeAttemptId: attempt.id,
    });

    await prisma.attempt.update({
      where: { id: attempt.id },
      data: { status: 'SUBMITTED', submittedAt: new Date() },
    });
    await prisma.exam.update({
      where: { id: exam.id },
      data: { status: 'ENDED' },
    });
    const ended = await request(student)
      .post('/api/v1/exams/join')
      .send({ roomCode: exam.roomCode });
    expect(ended.status).toBe(422);
    expect(ended.body.error.code).toBe('EXAM_ENDED');
  });

  it('reports a question deleted while the exam is being created', async () => {
    const doomed = await newQuestion(ids.teacher, 'Sắp bị xóa');
    // A delete in progress: holds the question row, then removes it.
    let commit!: () => void;
    const committed = new Promise<void>((resolve) => (commit = resolve));
    let locked!: () => void;
    const lockHeld = new Promise<void>((resolve) => (locked = resolve));
    const removal = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM questions
          WHERE id = ${doomed}::uuid FOR UPDATE`;
        locked();
        await committed;
        await tx.question.delete({ where: { id: doomed } });
      },
      { timeout: 15_000 },
    );
    await lockHeld;

    const title = `Race ${randomUUID()}`;
    const create = request(teacher)
      .post('/api/v1/exams')
      .send(examInput([{ questionId: doomed, points: 1 }], title))
      .then((res) => res);
    try {
      await waitForLockWait(prisma, RACE_CREATE_WAIT);
    } finally {
      commit();
      await removal;
    }
    const res = await create;
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details[0].field).toBe('questions.0.questionId');
    expect(await prisma.exam.count({ where: { title } })).toBe(0);
  });

  it('makes publish wait for an in-flight question edit', async () => {
    const exam = await newExam();
    // Hold the question the way an edit does (FOR UPDATE) until released.
    let release!: () => void;
    const released = new Promise<void>((resolve) => (release = resolve));
    let locked!: () => void;
    const lockHeld = new Promise<void>((resolve) => (locked = resolve));
    const edit = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM questions
          WHERE id = ${questionIds[0]!}::uuid FOR UPDATE`;
        locked();
        await released;
      },
      { timeout: 15_000 },
    );
    await lockHeld;

    let settled = false;
    const publish = request(teacher)
      .post(`/api/v1/exams/${exam.id}/publish`)
      .then((res) => {
        settled = true;
        return res;
      });
    try {
      await waitForLockWait(prisma, 'JOIN exam_questions');
      expect(settled).toBe(false);
    } finally {
      release();
      await edit;
    }
    expect((await publish).status).toBe(200);
  });

  it('rejects an exam edit that races its publish', async () => {
    const exam = await newExam();
    // Publish holds the exam row (FOR UPDATE) and leaves DRAFT, committing
    // only once the edit is waiting for that row.
    let commit!: () => void;
    const committed = new Promise<void>((resolve) => (commit = resolve));
    let locked!: () => void;
    const lockHeld = new Promise<void>((resolve) => (locked = resolve));
    const publish = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM exams
          WHERE id = ${exam.id}::uuid FOR UPDATE`;
        await tx.exam.update({
          where: { id: exam.id },
          data: { status: 'SCHEDULED' },
        });
        locked();
        await committed;
      },
      { timeout: 15_000 },
    );
    await lockHeld;

    const edit = request(teacher)
      .put(`/api/v1/exams/${exam.id}`)
      .send(examInput([], 'Sửa chen ngang'))
      .then((res) => res);
    try {
      await waitForLockWait(prisma, 'SELECT status FROM exams');
    } finally {
      commit();
      await publish;
    }
    const res = await edit;
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EXAM_NOT_EDITABLE');
    const stored = await prisma.exam.findUniqueOrThrow({
      where: { id: exam.id },
      include: { questions: true },
    });
    expect(stored.title).toBe('Kiểm tra 15 phút');
    expect(stored.questions).toHaveLength(1);
  });
});
