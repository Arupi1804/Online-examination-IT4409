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
import { createQuestionsRouter } from '../../src/modules/questions/controllers/questions.controller.js';
import { waitForLockWait } from './lock-wait.js';

// Uses PostgreSQL with database/init/*.sql applied: CI's service, or locally
// `pnpm infra:up` with the root .env. Skipped when DATABASE_URL is unset.
config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)) });

const origin = 'http://localhost:5173';
// requireRoles only reads req.principal, so this store never touches Redis.
const sessions = new AuthSessions({
  store: new AuthSessionStore(createClient(), 'oe:test:v1'),
  secret: 'questions-test-secret-at-least-32-chars',
  clientOrigin: origin,
  secureCookie: false,
});
let prisma: PrismaClient;

// Stands in for the session middleware: signs the request in as `user`.
function appAs(user?: { id: string; role: Role }) {
  const apiRouter = Router();
  apiRouter.use(
    '/questions',
    createQuestionsRouter(prisma, sessions.requireRoles('TEACHER')),
  );
  return createApp(origin, {
    apiRouter,
    sessionMiddleware: (req, _res, next) => {
      if (user) req.principal = { ...user, userId: user.id, sid: 'test' };
      next();
    },
  });
}

const single = (content = 'Thủ đô Việt Nam?') => ({
  type: 'SINGLE',
  content,
  options: [
    { content: 'Hà Nội', isCorrect: true },
    { content: 'Huế', isCorrect: false },
    { content: 'Đà Nẵng', isCorrect: false },
  ],
});
const roomCode = () =>
  Array.from(
    { length: 6 },
    () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)],
  ).join('');

describe.skipIf(!process.env.DATABASE_URL)('questions API', () => {
  const run = randomUUID().slice(0, 8);
  const ids: Record<'teacher' | 'other' | 'student', string> = {
    teacher: '',
    other: '',
    student: '',
  };
  let teacher: ReturnType<typeof appAs>;
  let other: ReturnType<typeof appAs>;

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
          email: `${key}-${run}@test.local`,
          passwordHash: 'x',
          name: key,
          role,
        },
      });
      ids[key] = user.id;
    }
    teacher = appAs({ id: ids.teacher, role: 'TEACHER' });
    other = appAs({ id: ids.other, role: 'TEACHER' });
  });

  afterAll(async () => {
    const ownerId = { in: [ids.teacher, ids.other] };
    await prisma.exam.deleteMany({ where: { ownerId } });
    await prisma.question.deleteMany({ where: { ownerId } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
    await prisma.$disconnect();
  });

  it('requires a teacher session', async () => {
    expect((await request(appAs()).get('/api/v1/questions')).status).toBe(401);
    const student = appAs({ id: ids.student, role: 'STUDENT' });
    const res = await request(student).get('/api/v1/questions');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('creates a question keeping option order and hiding the owner', async () => {
    const res = await request(teacher).post('/api/v1/questions').send(single());
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      type: 'SINGLE',
      explanation: null,
      inUse: false,
    });
    expect(
      res.body.data.options.map((o: { content: string }) => o.content),
    ).toEqual(['Hà Nội', 'Huế', 'Đà Nẵng']);
    expect(res.body.data).not.toHaveProperty('ownerId');
  });

  it('rejects invalid input with field details', async () => {
    const twoCorrect = {
      ...single(),
      options: single().options.map((o) => ({ ...o, isCorrect: true })),
    };
    const res = await request(teacher)
      .post('/api/v1/questions')
      .send(twoCorrect);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details[0].field).toBe('options');
  });

  it('rejects a page number too large for the database offset', async () => {
    const res = await request(teacher).get(
      '/api/v1/questions?page=1000000000000000000000000',
    );
    expect(res.status).toBe(400);
    expect(res.body.error.details[0].field).toBe('page');
  });

  it('lists only own questions with paging, type filter and search', async () => {
    await request(teacher)
      .post('/api/v1/questions')
      .send(single(`Tìm kiếm ${run}`));
    await request(other).post('/api/v1/questions').send(single());

    const all = await request(teacher).get('/api/v1/questions?pageSize=1');
    expect(all.status).toBe(200);
    expect(all.body.meta).toEqual({ page: 1, pageSize: 1, total: 2 });
    expect(all.body.data).toHaveLength(1);

    const found = await request(teacher).get(
      `/api/v1/questions?q=TÌM KIẾM ${run}`,
    );
    expect(found.body.meta.total).toBe(1);
    const none = await request(teacher).get('/api/v1/questions?type=MULTIPLE');
    expect(none.body.meta.total).toBe(0);
  });

  it("returns 404 for another teacher's question or a malformed id", async () => {
    const created = await request(teacher)
      .post('/api/v1/questions')
      .send(single());
    const id = created.body.data.id;
    expect((await request(other).get(`/api/v1/questions/${id}`)).status).toBe(
      404,
    );
    expect(
      (await request(other).put(`/api/v1/questions/${id}`).send(single()))
        .status,
    ).toBe(404);
    expect(
      (await request(other).delete(`/api/v1/questions/${id}`)).status,
    ).toBe(404);
    expect(
      (await request(teacher).get('/api/v1/questions/not-a-uuid')).status,
    ).toBe(404);
  });

  it('replaces content and options on update', async () => {
    const created = await request(teacher)
      .post('/api/v1/questions')
      .send(single());
    const id = created.body.data.id;
    const res = await request(teacher)
      .put(`/api/v1/questions/${id}`)
      .send({
        type: 'TRUE_FALSE',
        content: 'Trái Đất hình cầu?',
        explanation: 'Gần đúng',
        options: [
          { content: 'Đúng', isCorrect: true },
          { content: 'Sai', isCorrect: false },
        ],
      });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      type: 'TRUE_FALSE',
      explanation: 'Gần đúng',
    });
    expect(res.body.data.options).toHaveLength(2);
    expect(res.body.data.options[0].id).not.toBe(
      created.body.data.options[0].id,
    );
  });

  it('locks questions used by exams', async () => {
    const draftOnly = (
      await request(teacher).post('/api/v1/questions').send(single())
    ).body.data.id;
    const published = (
      await request(teacher).post('/api/v1/questions').send(single())
    ).body.data.id;
    for (const [questionId, status] of [
      [draftOnly, 'DRAFT'],
      [published, 'SCHEDULED'],
    ]) {
      await prisma.exam.create({
        data: {
          ownerId: ids.teacher,
          title: `Exam ${status}`,
          roomCode: roomCode(),
          durationSec: 600,
          status,
          questions: { create: { questionId, orderIndex: 0, points: 1 } },
        },
      });
    }

    const locked = await request(teacher).get(`/api/v1/questions/${published}`);
    expect(locked.body.data.inUse).toBe(true);
    const put = await request(teacher)
      .put(`/api/v1/questions/${published}`)
      .send(single());
    expect(put.status).toBe(409);
    expect(put.body.error.code).toBe('QUESTION_IN_USE');

    // A DRAFT exam allows editing but still blocks deletion.
    expect(
      (
        await request(teacher)
          .put(`/api/v1/questions/${draftOnly}`)
          .send(single())
      ).status,
    ).toBe(200);
    expect(
      (await request(teacher).delete(`/api/v1/questions/${draftOnly}`)).status,
    ).toBe(409);
  });

  it('rejects an edit that races the publish of its exam', async () => {
    const id = (
      await request(teacher)
        .post('/api/v1/questions')
        .send(single('Trước khi publish'))
    ).body.data.id;
    const exam = await prisma.exam.create({
      data: {
        ownerId: ids.teacher,
        title: 'Race',
        roomCode: roomCode(),
        durationSec: 600,
        questions: { create: { questionId: id, orderIndex: 0, points: 1 } },
      },
    });

    // Publish as docs/api-contract.md requires: lock the exam's questions,
    // leave DRAFT, and commit only once the edit is waiting for that lock.
    let commit!: () => void;
    const committed = new Promise<void>((resolve) => (commit = resolve));
    let locked!: () => void;
    const lockHeld = new Promise<void>((resolve) => (locked = resolve));
    const publish = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT q.id FROM questions q
          JOIN exam_questions eq ON eq.question_id = q.id
          WHERE eq.exam_id = ${exam.id}::uuid FOR SHARE OF q`;
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
      .put(`/api/v1/questions/${id}`)
      .send(single('Sau khi publish'))
      .then((res) => res);
    try {
      await waitForLockWait(prisma, 'SELECT id FROM questions');
    } finally {
      commit(); // never leave the publish holding its locks
      await publish;
    }

    const res = await edit;
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('QUESTION_IN_USE');
    const stored = await prisma.question.findUniqueOrThrow({
      where: { id },
      include: { options: true },
    });
    expect(stored.content).toBe('Trước khi publish');
    expect(stored.options).toHaveLength(3);
  });

  it('deletes an unused question', async () => {
    const id = (await request(teacher).post('/api/v1/questions').send(single()))
      .body.data.id;
    expect(
      (await request(teacher).delete(`/api/v1/questions/${id}`)).status,
    ).toBe(204);
    expect((await request(teacher).get(`/api/v1/questions/${id}`)).status).toBe(
      404,
    );
  });
});
