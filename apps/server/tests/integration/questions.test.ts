import { randomUUID } from 'node:crypto';
import express from 'express';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Role } from '@online-exam/shared';
import { prisma } from '../../src/core/prisma.js';
import { handleError } from '../../src/core/http/error-handler.js';
import { questionsRouter } from '../../src/modules/questions/controllers/questions.controller.js';

// Needs the local PostgreSQL from `pnpm infra:up` (core/prisma loads the root
// .env); skipped where DATABASE_URL is unset, e.g. CI without a database.

function appAs(user?: { id: string; role: Role }) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    Object.assign(req, { session: user && { user } });
    next();
  });
  app.use('/questions', questionsRouter);
  app.use(handleError);
  return app;
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
    expect((await request(appAs()).get('/questions')).status).toBe(401);
    const student = appAs({ id: ids.student, role: 'STUDENT' });
    const res = await request(student).get('/questions');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('creates a question keeping option order and hiding the owner', async () => {
    const res = await request(teacher).post('/questions').send(single());
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
    const res = await request(teacher).post('/questions').send(twoCorrect);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(res.body.error.details[0].field).toBe('options');
  });

  it('lists only own questions with paging, type filter and search', async () => {
    await request(teacher)
      .post('/questions')
      .send(single(`Tìm kiếm ${run}`));
    await request(other).post('/questions').send(single());

    const all = await request(teacher).get('/questions?pageSize=1');
    expect(all.status).toBe(200);
    expect(all.body.meta).toEqual({ page: 1, pageSize: 1, total: 2 });
    expect(all.body.data).toHaveLength(1);

    const found = await request(teacher).get(`/questions?q=TÌM KIẾM ${run}`);
    expect(found.body.meta.total).toBe(1);
    const none = await request(teacher).get('/questions?type=MULTIPLE');
    expect(none.body.meta.total).toBe(0);
  });

  it("returns 404 for another teacher's question or a malformed id", async () => {
    const created = await request(teacher).post('/questions').send(single());
    const id = created.body.data.id;
    expect((await request(other).get(`/questions/${id}`)).status).toBe(404);
    expect(
      (await request(other).put(`/questions/${id}`).send(single())).status,
    ).toBe(404);
    expect((await request(other).delete(`/questions/${id}`)).status).toBe(404);
    expect((await request(teacher).get('/questions/not-a-uuid')).status).toBe(
      404,
    );
  });

  it('replaces content and options on update', async () => {
    const created = await request(teacher).post('/questions').send(single());
    const id = created.body.data.id;
    const res = await request(teacher)
      .put(`/questions/${id}`)
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
    const draftOnly = (await request(teacher).post('/questions').send(single()))
      .body.data.id;
    const published = (await request(teacher).post('/questions').send(single()))
      .body.data.id;
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

    const locked = await request(teacher).get(`/questions/${published}`);
    expect(locked.body.data.inUse).toBe(true);
    const put = await request(teacher)
      .put(`/questions/${published}`)
      .send(single());
    expect(put.status).toBe(409);
    expect(put.body.error.code).toBe('QUESTION_IN_USE');

    // A DRAFT exam allows editing but still blocks deletion.
    expect(
      (await request(teacher).put(`/questions/${draftOnly}`).send(single()))
        .status,
    ).toBe(200);
    expect(
      (await request(teacher).delete(`/questions/${draftOnly}`)).status,
    ).toBe(409);
  });

  it('deletes an unused question', async () => {
    const id = (await request(teacher).post('/questions').send(single())).body
      .data.id;
    expect((await request(teacher).delete(`/questions/${id}`)).status).toBe(
      204,
    );
    expect((await request(teacher).get(`/questions/${id}`)).status).toBe(404);
  });
});
