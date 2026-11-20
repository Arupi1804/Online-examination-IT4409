import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import { AnswerAutosaver } from '../src/features/student/take-exam/answer-autosaver.ts';
import {
  clearAttemptDraft,
  readAttemptDraft,
  saveAttemptDraft,
} from '../src/features/student/take-exam/attempt-draft.ts';
import {
  readAttemptReference,
  saveAttemptReference,
} from '../src/features/student/take-exam/exam-storage.ts';
import {
  recoveredAttemptSchema,
  type SavedAnswer,
} from '../src/features/student/take-exam/exam-model.ts';
import { createApiExamService } from '../src/features/student/take-exam/api-exam-service.ts';
import { createMockExamService } from '../src/features/student/take-exam/mock-exam-service.ts';
import {
  attemptResultSchema,
  resultLabel,
} from '../src/features/student/results/result-model.ts';
import { observeExamDocument } from '../src/features/student/take-exam/proctor-observer.ts';
import {
  buildPaper,
  buildResult,
  examId,
  attemptId,
  qid,
  oid,
} from './fixtures/exam-fixture.ts';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
function storage() {
  const values = new Map<string, string>();
  vi.stubGlobal('sessionStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => values.delete(key),
  });
  return values;
}
function controller(
  options: {
    paused?: boolean;
    pending?: Record<string, string[]>;
    canSave?: () => boolean;
  } = {},
) {
  const calls: { questionId: string; selected: string[] }[] = [];
  const saver = new AnswerAutosaver({
    paper: buildPaper(),
    ...options,
    canSave: options.canSave ?? (() => true),
    save: async (questionId, selected) => {
      calls.push({ questionId, selected });
      return {
        questionId,
        selectedOptionIds: selected,
        updatedAt: new Date().toISOString(),
      };
    },
    onChange: () => undefined,
    onError: () => undefined,
  });
  return { saver, calls };
}

test('paused answers are editable and queued without requests; resume sends the newest selection', async () => {
  const { saver, calls } = controller({ paused: true });
  saver.choose(qid(1), [oid(11)]);
  saver.choose(qid(1), [oid(12)]);
  assert.equal(calls.length, 0);
  assert.equal(saver.snapshot().queuedCount, 1);
  assert.equal(await saver.flush(), false);
  saver.resume([]);
  assert.equal(await saver.flush(), true);
  assert.deepEqual(calls, [{ questionId: qid(1), selected: [oid(12)] }]);
});

test('rejoin preserves local pending choices, updates clean server answers and rejects foreign options', async () => {
  const { saver, calls } = controller({
    paused: true,
    pending: { [qid(1)]: [oid(12)] },
  });
  saver.resume([
    { questionId: qid(1), optionIds: [oid(11)] },
    { questionId: qid(2), optionIds: [oid(21)] },
  ]);
  assert.equal(await saver.flush(), true);
  assert.deepEqual(saver.snapshot().answers[qid(1)], [oid(12)]);
  assert.deepEqual(saver.snapshot().answers[qid(2)], [oid(21)]);
  assert.equal(calls.length, 1);
  saver.pause();
  assert.throws(() =>
    saver.resume([{ questionId: qid(1), optionIds: [oid(21)] }]),
  );
});

test('a cached uncertain choice is confirmed with PUT even if the rejoin snapshot already matches', async () => {
  const { saver, calls } = controller({
    paused: true,
    pending: { [qid(1)]: [oid(11)] },
  });
  saver.resume([{ questionId: qid(1), optionIds: [oid(11)] }]);
  assert.equal(await saver.flush(), true);
  assert.equal(calls.length, 1);
});

test('in-flight saves and a rejoin snapshot cannot overwrite a newer local selection', async () => {
  let resolve!: (answer: SavedAnswer) => void;
  const pending = new Promise<SavedAnswer>((done) => {
    resolve = done;
  });
  const calls: string[][] = [];
  const saver = new AnswerAutosaver({
    paper: buildPaper(),
    canSave: () => true,
    onChange: () => undefined,
    onError: () => undefined,
    save: async (id, selected) => {
      calls.push(selected);
      return calls.length === 1
        ? pending
        : {
            questionId: id,
            selectedOptionIds: selected,
            updatedAt: new Date().toISOString(),
          };
    },
  });
  saver.choose(qid(1), [oid(11)]);
  await Promise.resolve();
  saver.pause();
  saver.choose(qid(1), [oid(12)]);
  saver.resume([]);
  resolve({
    questionId: qid(1),
    selectedOptionIds: [oid(11)],
    updatedAt: new Date().toISOString(),
  });
  assert.equal(await saver.flush(), true);
  assert.deepEqual(calls, [[oid(11)], [oid(12)]]);
});

test('expired attempts never replay restored pending answers', async () => {
  const { saver, calls } = controller({
    paused: true,
    pending: { [qid(1)]: [oid(11)] },
    canSave: () => false,
  });
  saver.resume([]);
  assert.equal(await saver.flush(), false);
  assert.equal(calls.length, 0);
});

test('drafts are scoped to user, exam and attempt and reject invalid question choices', () => {
  const values = storage();
  const paper = buildPaper();
  const { saver } = controller({ paused: true });
  saver.choose(qid(1), [oid(11)]);
  assert.equal(saveAttemptDraft('a', paper, saver.snapshot()), true);
  assert.deepEqual(readAttemptDraft('a', paper), { [qid(1)]: [oid(11)] });
  assert.deepEqual(readAttemptDraft('b', paper), {});
  assert.deepEqual(
    readAttemptDraft('a', {
      ...paper,
      examId: 'c9ec68a2-0000-4000-8000-000000000099',
    }),
    {},
  );
  const key = [...values.keys()][0]!;
  values.set(
    key,
    JSON.stringify({
      attemptId,
      examId,
      answers: {
        [qid(1)]: [oid(21)],
        [qid(2)]: [oid(22)],
        [qid(99)]: [oid(11)],
      },
    }),
  );
  assert.deepEqual(readAttemptDraft('a', paper), { [qid(2)]: [oid(22)] });
  clearAttemptDraft('a', attemptId);
  assert.equal(values.size, 0);
});

test('draft write failures are reported and submitted attempts ignore pending caches', () => {
  const values = storage();
  const paper = buildPaper();
  const { saver } = controller({ paused: true });
  saver.choose(qid(1), [oid(11)]);
  saveAttemptDraft('a', paper, saver.snapshot());
  assert.deepEqual(
    readAttemptDraft('a', { ...paper, status: 'FORCE_SUBMITTED' }),
    {},
  );
  values.set([...values.keys()][0]!, 'corrupt');
  assert.deepEqual(readAttemptDraft('a', paper), {});
  vi.stubGlobal('sessionStorage', undefined);
  assert.equal(saveAttemptDraft('a', paper, saver.snapshot()), false);
});

test('result references are scoped to account and exam without caching score data', () => {
  storage();
  saveAttemptReference('a', examId, attemptId);
  assert.equal(readAttemptReference('a', examId), attemptId);
  assert.equal(readAttemptReference('b', examId), null);
  assert.equal(readAttemptReference('a', 'other-exam'), null);
});

test('recovered attempt validation requires matching clock and a timestamp when already submitted', () => {
  const base = {
    attemptId,
    examId,
    status: 'IN_PROGRESS',
    submittedAt: null,
    answers: [],
    clock: {
      examId,
      status: 'RUNNING',
      startTime: new Date().toISOString(),
      endTime: new Date().toISOString(),
      serverTime: new Date().toISOString(),
    },
  };
  assert.equal(recoveredAttemptSchema.safeParse(base).success, true);
  assert.equal(
    recoveredAttemptSchema.safeParse({ ...base, status: 'FORCE_SUBMITTED' })
      .success,
    false,
  );
  assert.equal(
    recoveredAttemptSchema.safeParse({
      ...base,
      clock: { ...base.clock, examId: 'c9ec68a2-0000-4000-8000-000000000099' },
    }).success,
    false,
  );
});

test('visibility and fullscreen observers report transitions once, skip initial background and clean up', () => {
  const target = Object.assign(new EventTarget(), {
    visibilityState: 'hidden' as DocumentVisibilityState,
    fullscreenElement: null as Element | null,
  });
  const events: string[] = [];
  const stop = observeExamDocument(
    target,
    (event) => events.push(event),
    () => undefined,
  );
  target.dispatchEvent(new Event('visibilitychange'));
  assert.equal(events.length, 0);
  target.visibilityState = 'visible';
  target.dispatchEvent(new Event('visibilitychange'));
  target.visibilityState = 'hidden';
  target.dispatchEvent(new Event('visibilitychange'));
  target.dispatchEvent(new Event('visibilitychange'));
  target.fullscreenElement = {} as Element;
  target.dispatchEvent(new Event('fullscreenchange'));
  target.fullscreenElement = null;
  target.dispatchEvent(new Event('fullscreenchange'));
  target.dispatchEvent(new Event('fullscreenchange'));
  target.dispatchEvent(new Event('blur'));
  target.dispatchEvent(new Event('offline'));
  assert.deepEqual(events, ['TAB_BLUR', 'FULLSCREEN_EXIT']);
  stop();
  target.visibilityState = 'visible';
  target.dispatchEvent(new Event('visibilitychange'));
  target.visibilityState = 'hidden';
  target.dispatchEvent(new Event('visibilitychange'));
  assert.equal(events.length, 2);
});

test('result schema accepts hidden details and server partial credit, without fabricating missing grades', () => {
  const paper = { ...buildPaper(), status: 'SUBMITTED' as const };
  const hidden = buildResult(paper, new Map());
  assert.equal(attemptResultSchema.safeParse(hidden).success, true);
  assert.equal(
    attemptResultSchema.safeParse({ ...hidden, score: null }).success,
    false,
  );
  assert.equal(
    attemptResultSchema.safeParse({ ...hidden, score: '0' }).success,
    false,
  );
  assert.equal(
    attemptResultSchema.safeParse({ ...hidden, score: 4, maxScore: 3 }).success,
    false,
  );
  const detailed = buildResult(
    paper,
    new Map([[qid(2), { selectedOptionIds: [oid(22)] }]]),
    true,
  );
  const parsed = attemptResultSchema.parse(detailed);
  assert.equal(parsed.score, 0.5);
  assert.equal(resultLabel(parsed.questions![1]!), 'Được một phần điểm');
});

test('result lookup uses the owner endpoint with cookies and never starts a new attempt', async () => {
  const result = buildResult(
    { ...buildPaper(), status: 'SUBMITTED' },
    new Map(),
  );
  const urls: string[] = [];
  vi.stubGlobal('fetch', async (url: string, options: RequestInit) => {
    urls.push(url);
    assert.equal(options.credentials, 'include');
    assert.equal(options.body, undefined);
    assert.equal(options.method ?? 'GET', 'GET');
    return Response.json({ data: result });
  });
  assert.deepEqual(
    await createApiExamService().result('a', examId, attemptId),
    result,
  );
  assert.deepEqual(urls, [`/api/v1/attempts/${attemptId}/result`]);
});

test('result lookup rejects another exam and malformed scores instead of showing a fake zero', async () => {
  const result = buildResult(
    { ...buildPaper(), status: 'SUBMITTED' },
    new Map(),
  );
  vi.stubGlobal('fetch', async () =>
    Response.json({
      data: { ...result, examId: 'c9ec68a2-0000-4000-8000-000000000099' },
    }),
  );
  await assert.rejects(createApiExamService().result('a', examId, attemptId));
  vi.stubGlobal('fetch', async () =>
    Response.json({ data: { ...result, score: undefined } }),
  );
  await assert.rejects(createApiExamService().result('a', examId, attemptId));
});

test('development mock restores submitted results after reload and keeps another user isolated', async () => {
  storage();
  vi.stubGlobal('navigator', { onLine: true });
  const demoExam = 'c9ec68a2-0000-4000-8000-000000000002';
  const service = createMockExamService();
  const loaded = await service.start('a', demoExam);
  await service.save(
    loaded.paper.attemptId,
    loaded.paper.questions[0]!.questionId,
    [loaded.paper.questions[0]!.options[0]!.id],
  );
  await service.submit(loaded.paper.attemptId);
  const reloaded = createMockExamService();
  const result = await reloaded.result('a', demoExam, loaded.paper.attemptId);
  assert.equal(result.score, 1);
  assert.equal(result.questions, null);
  await assert.rejects(reloaded.result('b', demoExam, loaded.paper.attemptId));
});
