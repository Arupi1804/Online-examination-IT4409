import { randomInt, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import { Router } from 'express';
import { PrismaClient } from '@prisma/client';
import { createClient } from 'redis';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Role } from '@online-exam/shared';
import { createApp } from '../../src/app.js';
import {
  AuthSessions,
  AuthSessionStore,
} from '../../src/modules/auth/index.js';
import {
  createAttemptsRouter,
  type AttemptEvents,
} from '../../src/modules/attempts/controllers/attempts.controller.js';
import { waitForLockWait } from './lock-wait.js';

// Uses PostgreSQL with database/init/*.sql applied: CI's service, or locally
// `pnpm infra:up` with the root .env. Skipped when DATABASE_URL is unset.
config({ path: fileURLToPath(new URL('../../../../.env', import.meta.url)) });

const origin = 'http://localhost:5173';
const sessions = new AuthSessions({
  store: new AuthSessionStore(createClient(), 'oe:test:v1'),
  secret: 'attempts-test-secret-at-least-32-characters',
  clientOrigin: origin,
  secureCookie: false,
});
let prisma: PrismaClient;

// The attempt lock taken by autosave and submit (core/db/locks.ts).
const ATTEMPT_LOCK = 'SELECT id FROM attempts WHERE id';

function appAs(
  user?: { id: string; role: Role },
  events?: AttemptEvents,
  logger: Pick<Console, 'error'> = { error: () => undefined },
) {
  const apiRouter = Router();
  apiRouter.use(
    createAttemptsRouter(
      prisma,
      {
        student: sessions.requireRoles('STUDENT'),
        studentOrTeacher: sessions.requireRoles('STUDENT', 'TEACHER'),
      },
      events,
      logger,
    ),
  );
  return createApp(origin, {
    apiRouter,
    sessionMiddleware: (req, _res, next) => {
      if (user) req.principal = { ...user, userId: user.id, sid: 'test' };
      next();
    },
  });
}

const ROOM_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const roomCode = () =>
  Array.from(
    { length: 6 },
    () => ROOM_ALPHABET[randomInt(ROOM_ALPHABET.length)],
  ).join('');

type Paper = {
  attemptId: string;
  questions: { questionId: string; options: { id: string }[] }[];
  answers: { questionId: string; selectedOptionIds: string[] }[];
};

describe.skipIf(!process.env.DATABASE_URL)('attempts API', () => {
  const run = randomUUID().slice(0, 8);
  const ids = { teacher: '', otherTeacher: '', student: '', other: '' };
  // single: [correct, wrong]; multiple: [correct, correct, wrong];
  // trueFalse: [correct, wrong]
  const q = {
    single: { id: '', options: [] as string[] },
    multiple: { id: '', options: [] as string[] },
    trueFalse: { id: '', options: [] as string[] },
    outside: { id: '', options: [] as string[] },
  };
  let student: ReturnType<typeof appAs>;

  async function newQuestion(
    type: 'SINGLE' | 'MULTIPLE' | 'TRUE_FALSE',
    correct: boolean[],
  ) {
    const row = await prisma.question.create({
      data: {
        ownerId: ids.teacher,
        type,
        content: `${type} ${run}`,
        explanation: 'Lời giải bí mật',
        options: {
          create: correct.map((isCorrect, orderIndex) => ({
            content: `Đáp án ${orderIndex}`,
            isCorrect,
            orderIndex,
          })),
        },
      },
      include: { options: { orderBy: { orderIndex: 'asc' } } },
    });
    return { id: row.id, options: row.options.map((o) => o.id) };
  }

  async function newExam({
    status = 'RUNNING',
    endInMs = 900_000,
    maxAttempts = 1,
    shuffle = false,
  } = {}) {
    const running = status === 'RUNNING' || status === 'ENDED';
    const exam = await prisma.exam.create({
      data: {
        ownerId: ids.teacher,
        title: `Bài làm ${run}`,
        roomCode: roomCode(),
        durationSec: 900,
        status,
        startTime: running ? new Date(Date.now() + endInMs - 900_000) : null,
        endTime: running ? new Date(Date.now() + endInMs) : null,
        maxAttempts,
        shuffleQuestions: shuffle,
        shuffleOptions: shuffle,
        questions: {
          create: [
            { questionId: q.single.id, orderIndex: 0, points: 1 },
            { questionId: q.multiple.id, orderIndex: 1, points: 2.5 },
            { questionId: q.trueFalse.id, orderIndex: 2, points: 0.5 },
          ],
        },
      },
    });
    return exam.id;
  }

  // exams has CHECK (end_time > start_time): move both.
  async function endExamIn(attemptId: string, endInMs: number) {
    const { examId } = await prisma.attempt.findUniqueOrThrow({
      where: { id: attemptId },
    });
    const endTime = new Date(Date.now() + endInMs);
    await prisma.exam.update({
      where: { id: examId },
      data: { startTime: new Date(endTime.getTime() - 900_000), endTime },
    });
  }

  async function start(examId: string, app = student) {
    const res = await request(app).post(`/api/v1/exams/${examId}/attempts`);
    return res;
  }

  async function startedAttempt(options?: Parameters<typeof newExam>[0]) {
    const res = await start(await newExam(options));
    expect(res.status).toBe(201);
    return res.body.data as Paper;
  }

  const save = (attemptId: string, questionId: string, ids: string[]) =>
    request(student)
      .put(`/api/v1/attempts/${attemptId}/answers/${questionId}`)
      .send({ selectedOptionIds: ids });

  /** Runs `fn` while another transaction holds the attempt and submits it. */
  async function whileSubmittedElsewhere<T>(
    attemptId: string,
    fn: () => Promise<T>,
  ) {
    let commit!: () => void;
    const committed = new Promise<void>((resolve) => (commit = resolve));
    let locked!: () => void;
    const lockHeld = new Promise<void>((resolve) => (locked = resolve));
    const other = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT id FROM attempts WHERE id = ${attemptId}::uuid FOR UPDATE`;
        await tx.attempt.update({
          where: { id: attemptId },
          data: {
            status: 'FORCE_SUBMITTED',
            submittedAt: new Date(),
            score: 0,
            maxScore: 4,
          },
        });
        locked();
        await committed;
      },
      { timeout: 15_000 },
    );
    await lockHeld;
    const pending = fn();
    try {
      await waitForLockWait(prisma, ATTEMPT_LOCK);
    } finally {
      commit();
      await other;
    }
    return pending;
  }

  beforeAll(async () => {
    prisma = new PrismaClient({
      datasources: { db: { url: process.env.DATABASE_URL } },
    });
    for (const [key, role] of [
      ['teacher', 'TEACHER'],
      ['otherTeacher', 'TEACHER'],
      ['student', 'STUDENT'],
      ['other', 'STUDENT'],
    ] as const) {
      const user = await prisma.user.create({
        data: {
          email: `attempt-${key}-${run}@test.local`,
          passwordHash: 'x',
          name: key,
          role,
        },
      });
      ids[key] = user.id;
    }
    q.single = await newQuestion('SINGLE', [true, false]);
    q.multiple = await newQuestion('MULTIPLE', [true, true, false]);
    q.trueFalse = await newQuestion('TRUE_FALSE', [true, false]);
    q.outside = await newQuestion('SINGLE', [true, false]);
    student = appAs({ id: ids.student, role: 'STUDENT' });
  });

  afterAll(async () => {
    const exam = { ownerId: ids.teacher };
    await prisma.answer.deleteMany({ where: { attempt: { exam } } });
    await prisma.attempt.deleteMany({ where: { exam } });
    await prisma.exam.deleteMany({ where: exam });
    await prisma.question.deleteMany({ where: { ownerId: ids.teacher } });
    await prisma.user.deleteMany({ where: { id: { in: Object.values(ids) } } });
    await prisma.$disconnect();
  });

  it('lets only students start, and only while the exam is running', async () => {
    const running = await newExam();
    expect((await start(running, appAs())).status).toBe(401);
    const teacher = appAs({ id: ids.teacher, role: 'TEACHER' });
    expect((await start(running, teacher)).status).toBe(403);
    expect((await start('not-a-uuid')).status).toBe(404);

    const draft = await start(await newExam({ status: 'DRAFT' }));
    expect(draft.status).toBe(404);
    const scheduled = await start(await newExam({ status: 'SCHEDULED' }));
    expect(scheduled.status).toBe(422);
    expect(scheduled.body.error.code).toBe('EXAM_NOT_STARTED');
    const late = await start(await newExam({ endInMs: -1_000 }));
    expect(late.status).toBe(422);
    expect(late.body.error.code).toBe('EXAM_ENDED');
    const ended = await start(await newExam({ status: 'ENDED' }));
    expect(ended.body.error.code).toBe('EXAM_ENDED');
  });

  it('hands out the paper without answers and resumes the same one', async () => {
    const examId = await newExam({ shuffle: true });
    const first = await start(examId);
    expect(first.status).toBe(201);
    const text = JSON.stringify(first.body);
    expect(text).not.toContain('isCorrect');
    expect(text).not.toContain('Lời giải bí mật');
    const paper = first.body.data as Paper;
    expect(paper.questions.map((x) => x.questionId).sort()).toEqual(
      [q.single.id, q.multiple.id, q.trueFalse.id].sort(),
    );
    expect(first.body.data).toMatchObject({
      examId,
      status: 'IN_PROGRESS',
      answers: [],
    });

    expect(
      (await save(paper.attemptId, q.single.id, [q.single.options[0]!])).status,
    ).toBe(200);
    const again = await start(examId);
    expect(again.status).toBe(200);
    expect(again.body.data.attemptId).toBe(paper.attemptId);
    expect(again.body.data.questions).toEqual(paper.questions);
    expect(again.body.data.answers).toMatchObject([
      { questionId: q.single.id, selectedOptionIds: [q.single.options[0]] },
    ]);
  });

  it('creates one attempt when the student starts several times at once', async () => {
    // Retried with maxAttempts 2 too: a submitted attempt must not make a
    // concurrent loser see "no attempts left".
    for (const maxAttempts of [1, 2]) {
      const examId = await newExam({ maxAttempts });
      if (maxAttempts === 2) {
        await prisma.attempt.create({
          data: {
            examId,
            userId: ids.student,
            status: 'SUBMITTED',
            submittedAt: new Date(),
          },
        });
      }
      const results = await Promise.all([1, 2, 3, 4].map(() => start(examId)));
      expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 201]);
      expect(new Set(results.map((r) => r.body.data.attemptId)).size).toBe(1);
      expect(
        await prisma.attempt.count({
          where: { examId, status: 'IN_PROGRESS' },
        }),
      ).toBe(1);
    }
  });

  it('stops at maxAttempts', async () => {
    const examId = await newExam({ maxAttempts: 1 });
    const { attemptId } = (await start(examId)).body.data as Paper;
    expect(
      (await request(student).post(`/api/v1/attempts/${attemptId}/submit`))
        .status,
    ).toBe(200);
    const again = await start(examId);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ATTEMPT_LIMIT_REACHED');
  });

  it('autosaves, validates and clears answers, then tells the monitor', async () => {
    const answerSaved = vi.fn();
    const app = appAs({ id: ids.student, role: 'STUDENT' }, { answerSaved });
    const { attemptId } = await startedAttempt();
    const put = (questionId: string, selectedOptionIds: string[]) =>
      request(app)
        .put(`/api/v1/attempts/${attemptId}/answers/${questionId}`)
        .send({ selectedOptionIds });

    const upper = q.multiple.options.slice(0, 2).map((x) => x.toUpperCase());
    const multi = await put(q.multiple.id.toUpperCase(), upper);
    expect(multi.status).toBe(200);
    expect(multi.body.data).toMatchObject({
      questionId: q.multiple.id,
      selectedOptionIds: q.multiple.options.slice(0, 2),
    });
    await vi.waitFor(() => expect(answerSaved).toHaveBeenCalledWith(attemptId));

    const two = await put(q.single.id, q.single.options);
    expect(two.status).toBe(400);
    expect(two.body.error.details).toEqual([
      { field: 'selectedOptionIds', issue: 'Only one option can be selected' },
    ]);
    const foreign = await put(q.single.id, [q.multiple.options[0]!]);
    expect(foreign.status).toBe(400);
    expect(foreign.body.error.details[0].field).toBe('selectedOptionIds.0');
    const id = q.single.options[0]!;
    const duplicate = await put(q.single.id, [id, id.toUpperCase()]);
    expect(duplicate.status).toBe(400);
    expect((await put(q.outside.id, [q.outside.options[0]!])).status).toBe(404);
    expect((await put(q.single.id, 'x' as never)).status).toBe(400);
    expect(answerSaved).toHaveBeenCalledTimes(1);

    const cleared = await put(q.multiple.id, []);
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.selectedOptionIds).toEqual([]);
    expect(await prisma.answer.count({ where: { attemptId } })).toBe(0);
    await vi.waitFor(() => expect(answerSaved).toHaveBeenCalledTimes(2));
  });

  it("hides other students' attempts and rejects answers after endTime", async () => {
    const { attemptId } = await startedAttempt();
    const other = appAs({ id: ids.other, role: 'STUDENT' });
    const foreign = await request(other)
      .put(`/api/v1/attempts/${attemptId}/answers/${q.single.id}`)
      .send({ selectedOptionIds: [] });
    expect(foreign.status).toBe(404);
    expect(
      (await request(other).post(`/api/v1/attempts/${attemptId}/submit`))
        .status,
    ).toBe(404);

    await endExamIn(attemptId, -1_000);
    const late = await save(attemptId, q.single.id, [q.single.options[0]!]);
    expect(late.status).toBe(422);
    expect(late.body.error.code).toBe('EXAM_ENDED');
  });

  it('grades on submit, once, and reports it to realtime', async () => {
    const submitted = vi.fn();
    const failingLogger = { error: vi.fn() };
    const app = appAs(
      { id: ids.student, role: 'STUDENT' },
      {
        submitted,
        answerSaved: () => {
          throw new Error('socket down');
        },
      },
      failingLogger,
    );
    const { attemptId } = await startedAttempt();
    const put = (questionId: string, selectedOptionIds: string[]) =>
      request(app)
        .put(`/api/v1/attempts/${attemptId}/answers/${questionId}`)
        .send({ selectedOptionIds });
    // A failing notification is logged; the saved answer still succeeds.
    expect((await put(q.single.id, [q.single.options[0]!])).status).toBe(200);
    await vi.waitFor(() => expect(failingLogger.error).toHaveBeenCalled());
    // Only one of the two correct options: no partial credit.
    await put(q.multiple.id, [q.multiple.options[0]!]);

    const res = await request(app).post(`/api/v1/attempts/${attemptId}/submit`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      attemptId,
      user: { id: ids.student, name: 'student' },
      status: 'SUBMITTED',
      score: 1,
      maxScore: 4,
      answeredCount: 2,
      violationCount: 0,
    });
    await vi.waitFor(() =>
      expect(submitted).toHaveBeenCalledWith(
        expect.objectContaining({
          attemptId,
          userId: ids.student,
          status: 'SUBMITTED',
        }),
      ),
    );

    const twice = await request(app).post(
      `/api/v1/attempts/${attemptId}/submit`,
    );
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe('ATTEMPT_ALREADY_SUBMITTED');
    expect((await put(q.single.id, [])).status).toBe(409);
    expect(submitted).toHaveBeenCalledTimes(1);
  });

  it('accepts a submission until endTime + 5 seconds', async () => {
    const grace = await startedAttempt({ endInMs: 900_000 });
    const tooLate = await startedAttempt({ endInMs: 900_000 });
    for (const [paper, endInMs] of [
      [grace, -2_000],
      [tooLate, -30_000],
    ] as const) {
      await endExamIn(paper.attemptId, endInMs);
    }
    const ok = await request(student).post(
      `/api/v1/attempts/${grace.attemptId}/submit`,
    );
    expect(ok.status).toBe(200);
    const late = await request(student).post(
      `/api/v1/attempts/${tooLate.attemptId}/submit`,
    );
    expect(late.status).toBe(422);
    expect(late.body.error.code).toBe('SUBMIT_TOO_LATE');
  });

  it('does not save an answer while the attempt is being submitted', async () => {
    const { attemptId } = await startedAttempt();
    const res = await whileSubmittedElsewhere(attemptId, () =>
      save(attemptId, q.single.id, [q.single.options[0]!]).then((r) => r),
    );
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ATTEMPT_ALREADY_SUBMITTED');
    expect(await prisma.answer.count({ where: { attemptId } })).toBe(0);
  });

  it('does not grade an attempt a second time while it is being submitted', async () => {
    const { attemptId } = await startedAttempt();
    const res = await whileSubmittedElsewhere(attemptId, () =>
      request(student)
        .post(`/api/v1/attempts/${attemptId}/submit`)
        .then((r) => r),
    );
    expect(res.status).toBe(409);
    const stored = await prisma.attempt.findUniqueOrThrow({
      where: { id: attemptId },
    });
    expect(stored.status).toBe('FORCE_SUBMITTED');
  });

  it('shows the result to its student, and the answers only after the exam ends', async () => {
    const { attemptId } = await startedAttempt();
    const result = (app = student) =>
      request(app).get(`/api/v1/attempts/${attemptId}/result`);
    await save(attemptId, q.single.id, [q.single.options[0]!]);
    await save(attemptId, q.multiple.id, [q.multiple.options[0]!]);
    const early = await result();
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe('ATTEMPT_NOT_SUBMITTED');
    await request(student).post(`/api/v1/attempts/${attemptId}/submit`);

    expect((await result(appAs())).status).toBe(401);
    const strangers = [
      appAs({ id: ids.other, role: 'STUDENT' }),
      appAs({ id: ids.otherTeacher, role: 'TEACHER' }),
    ];
    for (const app of strangers) expect((await result(app)).status).toBe(404);

    // Exam still running: score only, nothing that gives answers away.
    const running = await result();
    expect(running.status).toBe(200);
    expect(running.body.data).toMatchObject({
      attemptId,
      examTitle: `Bài làm ${run}`,
      status: 'SUBMITTED',
      score: 1,
      maxScore: 4,
      questions: null,
    });
    expect(JSON.stringify(running.body)).not.toContain('isCorrect');

    const expected = [
      {
        questionId: q.single.id,
        explanation: 'Lời giải bí mật',
        points: 1,
        earnedPoints: 1,
        selectedOptionIds: [q.single.options[0]],
      },
      {
        questionId: q.multiple.id,
        points: 2.5,
        earnedPoints: 0,
        selectedOptionIds: [q.multiple.options[0]],
      },
      {
        questionId: q.trueFalse.id,
        points: 0.5,
        earnedPoints: 0,
        selectedOptionIds: [],
      },
    ];
    // The exam's teacher always sees the full result.
    const teacher = await result(appAs({ id: ids.teacher, role: 'TEACHER' }));
    expect(teacher.status).toBe(200);
    expect(teacher.body.data.questions).toMatchObject(expected);
    expect(teacher.body.data.questions[0].options).toEqual([
      { id: q.single.options[0], content: 'Đáp án 0', isCorrect: true },
      { id: q.single.options[1], content: 'Đáp án 1', isCorrect: false },
    ]);

    const { examId } = await prisma.attempt.findUniqueOrThrow({
      where: { id: attemptId },
    });
    await prisma.exam.update({
      where: { id: examId },
      data: { status: 'ENDED' },
    });
    const ended = await result();
    expect(ended.body.data.questions).toMatchObject(expected);
  });
});
