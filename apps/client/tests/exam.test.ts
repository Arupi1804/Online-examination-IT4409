import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import {
  AnswerAutosaver,
  type AnswerSnapshot,
} from '../src/features/student/take-exam/answer-autosaver.ts';
import { createApiExamService } from '../src/features/student/take-exam/api-exam-service.ts';
import {
  attemptPaperSchema,
  formatRemaining,
  remainingSeconds,
  type SavedAnswer,
} from '../src/features/student/take-exam/exam-model.ts';
import {
  buildPaper,
  examId,
  attemptId,
  qid,
  oid,
} from './fixtures/exam-fixture.ts';
import {
  readExamUI,
  saveExamUI,
} from '../src/features/student/take-exam/exam-storage.ts';
import { ApiError } from '../src/services/api.ts';

afterEach(() => vi.unstubAllGlobals());
const saved = (
  questionId: string,
  selectedOptionIds: string[],
): SavedAnswer => ({
  questionId,
  selectedOptionIds,
  updatedAt: new Date().toISOString(),
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
const microtasks = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};
function autosaver(
  save: (id: string, selected: string[]) => Promise<SavedAnswer>,
  canSave = () => true,
) {
  const snapshots: AnswerSnapshot[] = [];
  const errors: unknown[] = [];
  const controller = new AnswerAutosaver({
    paper: buildPaper(),
    save,
    canSave,
    onChange: (snapshot) => snapshots.push(snapshot),
    onError: (error) => errors.push(error),
  });
  return { controller, snapshots, errors };
}

test('exam paper rejects selections from another question, duplicates and invalid single choices', () => {
  for (const selected of [[oid(21)], [oid(11), oid(12)], [oid(11), oid(11)]]) {
    const paper = buildPaper();
    paper.answers = [saved(qid(1), selected)];
    assert.equal(attemptPaperSchema.safeParse(paper).success, false);
  }
  const paper = buildPaper();
  paper.questions.push(paper.questions[0]!);
  assert.equal(attemptPaperSchema.safeParse(paper).success, false);
  assert.equal(
    attemptPaperSchema.safeParse({ ...buildPaper(), questions: [] }).success,
    false,
  );
});

test('start shares concurrent requests, sends cookie credentials and preserves the server paper order', async () => {
  const paper = buildPaper();
  paper.questions.reverse();
  const response = deferred<Response>();
  const fetch = vi.fn((_url: string, options: RequestInit) => {
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'include');
    assert.equal(options.body, undefined);
    return response.promise;
  });
  vi.stubGlobal('fetch', fetch);
  const service = createApiExamService();
  const first = service.start('student-a', examId);
  const second = service.start('student-a', examId);
  assert.equal(first, second);
  response.resolve(Response.json({ data: paper }));
  const result = await first;
  assert.equal(fetch.mock.calls.length, 1);
  assert.deepEqual(result.paper.questions, paper.questions);
  assert.ok(result.clock.roundTripMs >= 0);
  assert.equal(fetch.mock.calls[0]![0], `/api/v1/exams/${examId}/attempts`);
});

test('start rejects mismatched exams and permits a fresh retry after failure', async () => {
  const fetch = vi.fn(async () =>
    Response.json({
      data: { ...buildPaper(), examId: 'c9ec68a2-0000-4000-8000-000000000099' },
    }),
  );
  vi.stubGlobal('fetch', fetch);
  const service = createApiExamService();
  await assert.rejects(service.start('student-a', examId));
  await assert.rejects(service.start('student-a', examId));
  assert.equal(fetch.mock.calls.length, 2);
});

test('save uses PUT and selectedOptionIds only, supports clearing and rejects mismatched acknowledgments', async () => {
  vi.stubGlobal('fetch', async (url: string, options: RequestInit) => {
    assert.equal(url, `/api/v1/attempts/${attemptId}/answers/${qid(1)}`);
    assert.equal(options.method, 'PUT');
    assert.deepEqual(JSON.parse(options.body as string), {
      selectedOptionIds: [],
    });
    return Response.json({ data: saved(qid(1), []) });
  });
  assert.deepEqual(
    (await createApiExamService().save(attemptId, qid(1), []))
      .selectedOptionIds,
    [],
  );
  vi.stubGlobal('fetch', async () =>
    Response.json({ data: saved(qid(2), [oid(21)]) }),
  );
  await assert.rejects(
    createApiExamService().save(attemptId, qid(1), [oid(11)]),
  );
});

test('submit consumes only server confirmation and rejects an IN_PROGRESS response', async () => {
  vi.stubGlobal('fetch', async (url: string, options: RequestInit) => {
    assert.equal(url, `/api/v1/attempts/${attemptId}/submit`);
    assert.equal(options.method, 'POST');
    assert.equal(options.body, undefined);
    return Response.json({
      data: {
        examId,
        attemptId,
        status: 'IN_PROGRESS',
        submittedAt: new Date().toISOString(),
      },
    });
  });
  await assert.rejects(createApiExamService().submit(attemptId));
});

test('autosave serializes each question and sends only the latest queued choice after an older save', async () => {
  const first = deferred<SavedAnswer>();
  const calls: string[][] = [];
  const { controller } = autosaver(async (id, selected) => {
    calls.push([...selected]);
    return calls.length === 1 ? first.promise : saved(id, selected);
  });
  controller.choose(qid(1), [oid(11)]);
  await microtasks();
  controller.choose(qid(1), [oid(12)]);
  controller.choose(qid(1), [oid(13)]);
  assert.deepEqual(calls, [[oid(11)]]);
  assert.equal(controller.snapshot().statuses[qid(1)], 'saving');
  first.resolve(saved(qid(1), [oid(11)]));
  assert.equal(await controller.flush(), true);
  assert.deepEqual(calls, [[oid(11)], [oid(13)]]);
  assert.deepEqual(controller.snapshot().answers[qid(1)], [oid(13)]);
});

test('different questions save independently while submit flush waits for every request', async () => {
  const slow = deferred<SavedAnswer>();
  const { controller } = autosaver(async (id, selected) =>
    id === qid(1) ? slow.promise : saved(id, selected),
  );
  controller.choose(qid(1), [oid(11)]);
  controller.choose(qid(2), [oid(21), oid(22)]);
  await microtasks();
  assert.equal(controller.snapshot().statuses[qid(2)], 'saved');
  let flushed = false;
  const flush = controller.flush().then((success) => {
    flushed = success;
  });
  await microtasks();
  assert.equal(flushed, false);
  slow.resolve(saved(qid(1), [oid(11)]));
  await flush;
  assert.equal(flushed, true);
});

test('failed autosave keeps the latest answer, stops retry loops and retries deliberately', async () => {
  let fail = true;
  let calls = 0;
  const { controller } = autosaver(async (id, selected) => {
    calls += 1;
    if (fail) throw new ApiError(503, 'Unavailable');
    return saved(id, selected);
  });
  controller.choose(qid(1), [oid(11)]);
  assert.equal(await controller.flush(), false);
  assert.equal(controller.snapshot().failedCount, 1);
  await microtasks();
  assert.equal(calls, 1);
  assert.deepEqual(controller.snapshot().answers[qid(1)], [oid(11)]);
  fail = false;
  controller.retryFailed();
  assert.equal(await controller.flush(), true);
  assert.equal(calls, 2);
});

test('uncertain responses cannot claim a reverted answer is saved without sending it again', async () => {
  const first = deferred<SavedAnswer>();
  const calls: string[][] = [];
  const { controller } = autosaver(async (id, selected) => {
    calls.push([...selected]);
    return calls.length === 1 ? first.promise : saved(id, selected);
  });
  controller.choose(qid(1), [oid(11)]);
  await microtasks();
  controller.choose(qid(1), []);
  first.reject(new TypeError('Connection lost after commit'));
  assert.equal(await controller.flush(), false);
  assert.equal(controller.snapshot().statuses[qid(1)], 'error');
  controller.retryFailed();
  assert.equal(await controller.flush(), true);
  assert.deepEqual(calls, [[oid(11)], []]);
});

test('autosave rejects foreign option IDs and stops queued writes after deadline or disposal', async () => {
  let writable = true;
  const first = deferred<SavedAnswer>();
  const calls: string[][] = [];
  const { controller } = autosaver(
    async (_id, selected) => {
      calls.push(selected);
      return first.promise;
    },
    () => writable,
  );
  controller.choose(qid(1), [oid(21)]);
  controller.choose(qid(1), [oid(11), oid(12)]);
  assert.equal(calls.length, 0);
  controller.choose(qid(1), [oid(11)]);
  await microtasks();
  controller.choose(qid(1), [oid(12)]);
  writable = false;
  first.resolve(saved(qid(1), [oid(11)]));
  assert.equal(await controller.flush(), false);
  assert.equal(calls.length, 1);
  controller.dispose();
  writable = true;
  controller.retryFailed();
  controller.choose(qid(1), [oid(13)]);
  assert.equal(calls.length, 1);
});

test('countdown uses server time, monotonic elapsed time and response latency without local wall-clock dependence', () => {
  const clock = {
    examId,
    status: 'RUNNING' as const,
    serverTime: '2026-11-20T09:00:00Z',
    endTime: '2026-11-20T09:01:00Z',
    receivedAt: 100,
    roundTripMs: 2000,
  };
  vi.spyOn(Date, 'now').mockReturnValue(0);
  assert.equal(remainingSeconds(clock, 100), 59);
  assert.equal(remainingSeconds(clock, 30100), 29);
  vi.spyOn(Date, 'now').mockReturnValue(9999999999999);
  assert.equal(remainingSeconds(clock, 60100), 0);
  vi.restoreAllMocks();
  assert.equal(formatRemaining(65), '01:05');
  assert.equal(formatRemaining(3661), '01:01:01');
});

test('question marks and navigation are isolated by account and attempt, never stored as answers', () => {
  const values = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  });
  const paper = buildPaper();
  saveExamUI('a', paper.attemptId, qid(2), [qid(1), qid(1), qid(99)]);
  assert.deepEqual(readExamUI('a', paper), {
    currentQuestionId: qid(2),
    flaggedQuestionIds: [qid(1)],
  });
  assert.equal(readExamUI('b', paper).currentQuestionId, qid(1));
  assert.equal([...values.values()][0]!.includes('selectedOptionIds'), false);
});
