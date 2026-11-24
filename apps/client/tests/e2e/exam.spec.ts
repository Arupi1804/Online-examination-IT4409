import { expect, test, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { WS_NAMESPACE } from '@online-exam/shared';
import {
  buildPaper,
  examId,
  attemptId,
  oid,
  qid,
  profile,
  buildResult,
} from '../fixtures/exam-fixture';
import type {
  AttemptPaper,
  SavedAnswer,
} from '../../src/features/student/take-exam/exam-model';

// Protocol fixtures only. This suite never starts the project's real backend.
let io: Server;
let paper: AttemptPaper;
let answers: Map<string, SavedAnswer>;
let saveCalls: { questionId: string; selectedOptionIds: string[] }[];
let starts: number;
let submits: number;
let logouts: number;
let saveError: number;
let startError: string | null;
let signedIn: boolean;
let offset: number;
let saveGate: Promise<void> | null;
let releaseSave: (() => void) | null;
let rejoinCalls: unknown[];
let heartbeatCalls: unknown[];
let violations: { attemptId: string; type: string; clientAt: string }[];
let recoverPaused: boolean;
let recoverCallbacks: (() => void)[];
let detailsPublished: boolean;
let resultOverride: unknown;
let resultHttpError: number;
let resultRequests: number;

function clock(status = 'RUNNING') {
  return {
    examId,
    status,
    startTime: paper.startedAt,
    endTime: paper.endTime,
    serverTime: new Date(Date.now() + offset).toISOString(),
  };
}
test.beforeAll(async () => {
  const http = createServer();
  io = new Server(http, {
    cors: { origin: 'http://localhost:5174', credentials: true },
  });
  io.of('/').use((_socket, next) => next(new Error('Use /exam namespace')));
  io.of(WS_NAMESPACE).on('connection', (socket) => {
    socket.on('room:join', (payload, ack) => {
      expect(payload).toEqual({ examId });
      ack({
        ok: true,
        data: { ...clock(), roomCode: 'K7M2QX', participantCount: 1 },
      });
    });
    socket.on('attempt:rejoin', (payload, ack) => {
      expect(payload).toEqual({ attemptId });
      rejoinCalls.push(payload);
      const respond = () => {
        if (!socket.connected) return;
        const state = {
          attemptId,
          examId,
          status: paper.status,
          submittedAt:
            paper.status === 'IN_PROGRESS'
              ? null
              : new Date(Date.now() + offset).toISOString(),
          answers: [...answers.values()].map((answer) => ({
            questionId: answer.questionId,
            optionIds: answer.selectedOptionIds,
          })),
          clock: clock(),
        };
        socket.emit('attempt:state', state);
        ack({ ok: true, data: state });
      };
      if (recoverPaused) recoverCallbacks.push(respond);
      else respond();
    });
    socket.on('proctor:heartbeat', (payload, ack) => {
      expect(payload).toEqual({ attemptId });
      heartbeatCalls.push(payload);
      ack({
        ok: true,
        data: { serverTime: new Date(Date.now() + offset).toISOString() },
      });
    });
    socket.on('proctor:violation', (payload, ack) => {
      expect(Object.keys(payload).sort()).toEqual([
        'attemptId',
        'clientAt',
        'type',
      ]);
      expect(payload.attemptId).toBe(attemptId);
      expect(['TAB_BLUR', 'FULLSCREEN_EXIT']).toContain(payload.type);
      violations.push(payload);
      ack({
        ok: true,
        data: { at: new Date(Date.now() + offset).toISOString() },
      });
    });
  });
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(5190, 'localhost', resolve);
  });
});
test.afterAll(async () => {
  await new Promise<void>((resolve) => io.close(() => resolve()));
});
test.afterEach(() => {
  releaseSave?.();
});

test.beforeEach(async ({ page }) => {
  io.of(WS_NAMESPACE).disconnectSockets(true);
  offset = 3 * 3600000; // Deliberately different from the browser's wall clock.
  paper = buildPaper(1200, offset);
  answers = new Map();
  saveCalls = [];
  starts = 0;
  submits = 0;
  logouts = 0;
  saveError = 0;
  startError = null;
  signedIn = true;
  saveGate = null;
  releaseSave = null;
  rejoinCalls = [];
  heartbeatCalls = [];
  violations = [];
  recoverPaused = false;
  recoverCallbacks = [];
  detailsPublished = false;
  resultOverride = null;
  resultHttpError = 0;
  resultRequests = 0;
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/v1/auth/me') {
      await route.fulfill({
        status: signedIn ? 200 : 401,
        json: signedIn
          ? { data: profile }
          : { error: { code: 'AUTH_SESSION_EXPIRED', message: 'Expired' } },
      });
    } else if (path === '/api/v1/auth/logout') {
      logouts += 1;
      signedIn = false;
      await route.fulfill({ status: 204 });
    } else if (path === `/api/v1/exams/${examId}/attempts`) {
      starts += 1;
      if (startError) {
        await route.fulfill({
          status: 409,
          json: { error: { code: startError, message: 'Fixture start error' } },
        });
        return;
      }
      await route.fulfill({
        json: {
          data: {
            ...paper,
            serverTime: new Date(Date.now() + offset).toISOString(),
            answers: [...answers.values()],
          },
        },
      });
    } else if (path === `/api/v1/attempts/${attemptId}/result`) {
      resultRequests += 1;
      if (resultHttpError) {
        await route.fulfill({
          status: resultHttpError,
          json: {
            error: {
              code:
                resultHttpError === 403 ? 'FORBIDDEN' : 'SERVICE_UNAVAILABLE',
              message: 'Fixture',
            },
          },
        });
      } else if (paper.status === 'IN_PROGRESS') {
        await route.fulfill({
          status: 409,
          json: {
            error: { code: 'ATTEMPT_NOT_SUBMITTED', message: 'Not submitted' },
          },
        });
      } else
        await route.fulfill({
          json: {
            data:
              resultOverride ??
              buildResult(
                {
                  ...paper,
                  serverTime: new Date(Date.now() + offset).toISOString(),
                },
                answers,
                detailsPublished,
              ),
          },
        });
    } else if (path.includes('/answers/')) {
      const questionId = path.split('/').at(-1)!;
      const body = route.request().postDataJSON();
      expect(route.request().method()).toBe('PUT');
      expect(Object.keys(body)).toEqual(['selectedOptionIds']);
      saveCalls.push({ questionId, selectedOptionIds: body.selectedOptionIds });
      const gate = saveGate;
      saveGate = null;
      if (gate) await gate;
      if (saveError) {
        const status = saveError;
        saveError = 0;
        if (status === 401) signedIn = false;
        await route.fulfill({
          status,
          json: {
            error: {
              code:
                status === 401 ? 'AUTH_SESSION_EXPIRED' : 'SERVICE_UNAVAILABLE',
              message: 'Fixture write error',
            },
          },
        });
        return;
      }
      const answer = {
        questionId,
        selectedOptionIds: body.selectedOptionIds,
        updatedAt: new Date(Date.now() + offset).toISOString(),
      };
      answers.set(questionId, answer);
      await route.fulfill({ json: { data: answer } });
    } else if (path === `/api/v1/attempts/${attemptId}/submit`) {
      expect(route.request().method()).toBe('POST');
      submits += 1;
      paper.status = 'SUBMITTED';
      await route.fulfill({
        json: {
          data: {
            attemptId,
            examId,
            status: 'SUBMITTED',
            submittedAt: new Date(Date.now() + offset).toISOString(),
            score: buildResult(paper, answers).score,
            maxScore: 3,
            user: profile,
            answeredCount: answers.size,
            violationCount: 0,
            startedAt: paper.startedAt,
          },
        },
      });
    } else await route.abort();
  });
});

async function openExam(page: Page) {
  await page.goto(`/exam/${examId}/take`);
  await expect(
    page.getByRole('heading', { name: 'Bài thi của bạn', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Đang đồng bộ thời gian', { exact: true }),
  ).toBeVisible();
}
async function saved(page: Page) {
  await expect(page.getByTestId('save-status')).toHaveText(
    'Mọi thay đổi đã được lưu',
  );
}
function holdSave() {
  saveGate = new Promise<void>((resolve) => {
    releaseSave = resolve;
  });
}

test('student answers all question types, clears choices, flags questions and restores saved work', async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openExam(page);
  expect(starts).toBe(1);
  await expect(page.getByTestId('exam-timer')).toHaveText(/^(20:00|19:5\d)$/);
  await page.getByRole('radio', { name: 'GET', exact: true }).check();
  await saved(page);
  await page.getByRole('button', { name: 'Đánh dấu câu', exact: true }).click();
  await page.getByRole('button', { name: 'Câu tiếp', exact: true }).click();
  await page.getByRole('checkbox', { name: '200 OK', exact: true }).check();
  await page
    .getByRole('checkbox', { name: '201 Created', exact: true })
    .check();
  await saved(page);
  expect(answers.get(qid(2))?.selectedOptionIds).toEqual([oid(21), oid(22)]);
  await page
    .getByRole('button', { name: 'Bỏ chọn đáp án', exact: true })
    .click();
  await saved(page);
  expect(answers.get(qid(2))?.selectedOptionIds).toEqual([]);
  await page
    .getByRole('checkbox', { name: '201 Created', exact: true })
    .check();
  await saved(page);
  await page.screenshot({
    path: testInfo.outputPath('exam-desktop.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Câu tiếp', exact: true }).click();
  await page.getByRole('radio', { name: 'Đúng', exact: true }).check();
  await saved(page);
  await page.reload();
  await expect(
    page.getByRole('radio', { name: 'Đúng', exact: true }),
  ).toBeChecked();
  await page
    .getByRole('button', { name: /^Câu 1, đã trả lời, đã đánh dấu$/ })
    .click();
  await expect(
    page.getByRole('radio', { name: 'GET', exact: true }),
  ).toBeChecked();
  await expect(
    page.getByRole('button', { name: 'Đã đánh dấu', exact: true }),
  ).toHaveAttribute('aria-pressed', 'true');
  expect(submits).toBe(0);
  expect(errors).toEqual([]);
});

test('rapid answer changes are serialized and an old response never replaces the newest choice', async ({
  page,
}) => {
  await openExam(page);
  holdSave();
  await page.getByRole('radio', { name: 'GET', exact: true }).check();
  await expect.poll(() => saveCalls.length).toBe(1);
  await page.getByRole('radio', { name: 'POST', exact: true }).check();
  await page.getByRole('radio', { name: 'DELETE', exact: true }).check();
  expect(saveCalls).toHaveLength(1);
  await expect(page.getByTestId('save-status')).toContainText('Đang lưu');
  releaseSave!();
  await saved(page);
  expect(saveCalls.map((call) => call.selectedOptionIds)).toEqual([
    [oid(11)],
    [oid(13)],
  ]);
  await expect(
    page.getByRole('radio', { name: 'DELETE', exact: true }),
  ).toBeChecked();
  expect(answers.get(qid(1))?.selectedOptionIds).toEqual([oid(13)]);
});

test('submission waits for pending saves, confirms unanswered questions and sends exactly once', async ({
  page,
}) => {
  await openExam(page);
  holdSave();
  await page.getByRole('radio', { name: 'GET', exact: true }).check();
  await expect.poll(() => saveCalls.length).toBe(1);
  await page.getByRole('button', { name: 'Nộp bài', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('2 câu');
  await dialog
    .getByRole('button', { name: 'Xác nhận nộp bài', exact: true })
    .click();
  expect(submits).toBe(0);
  await expect(
    dialog.getByRole('button', { name: 'Đang nộp bài...', exact: true }),
  ).toBeDisabled();
  releaseSave!();
  await expect(
    page.getByRole('heading', { name: 'Kết quả bài thi', exact: true }),
  ).toBeVisible();
  expect(submits).toBe(1);
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect.poll(() => io.engine.clientsCount).toBe(0);
});

test('failed saves remain visible, block submission and can be retried from the confirmation dialog', async ({
  page,
}) => {
  await openExam(page);
  saveError = 503;
  await page.getByRole('radio', { name: 'GET', exact: true }).check();
  await expect(page.getByTestId('save-status')).toContainText(
    '1 câu chưa lưu thành công',
  );
  await page.getByRole('button', { name: 'Nộp bài', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('button', { name: 'Xác nhận nộp bài', exact: true }),
  ).toBeDisabled();
  expect(submits).toBe(0);
  await dialog
    .getByRole('button', { name: 'Thử lưu lại', exact: true })
    .click();
  await expect(
    dialog.getByRole('button', { name: 'Xác nhận nộp bài', exact: true }),
  ).toBeEnabled();
  await dialog
    .getByRole('button', { name: 'Tiếp tục làm bài', exact: true })
    .click();
  await expect(
    page.getByRole('radio', { name: 'GET', exact: true }),
  ).toBeChecked();
  await saved(page);
});

test('expiry locks answers without client submission, extension resyncs and only server confirmation finishes', async ({
  page,
}) => {
  paper = buildPaper(1.5, offset);
  await openExam(page);
  await expect(
    page.getByRole('radio', { name: 'GET', exact: true }),
  ).toBeDisabled({ timeout: 5000 });
  await expect(page.getByRole('alert')).toContainText(
    'Đã hết thời gian làm bài',
  );
  expect(submits).toBe(0);
  paper.endTime = new Date(Date.now() + offset + 600000).toISOString();
  io.of(WS_NAMESPACE).emit('exam:extended', clock());
  await expect(
    page.getByRole('radio', { name: 'GET', exact: true }),
  ).toBeEnabled();
  io.of(WS_NAMESPACE).emit('exam:ended', clock('ENDED'));
  await expect(
    page.getByRole('radio', { name: 'GET', exact: true }),
  ).toBeDisabled();
  io.of(WS_NAMESPACE).emit('attempt:submitted', {
    examId,
    attemptId: 'd1000000-0000-4000-8000-000000000099',
    status: 'AUTO_SUBMITTED',
    submittedAt: new Date().toISOString(),
  });
  await expect(
    page.getByRole('heading', { name: 'Kết quả bài thi', exact: true }),
  ).toHaveCount(0);
  paper.status = 'AUTO_SUBMITTED';
  io.of(WS_NAMESPACE).emit('attempt:submitted', {
    examId,
    attemptId,
    status: 'AUTO_SUBMITTED',
    submittedAt: new Date().toISOString(),
  });
  await expect(
    page.getByRole('heading', { name: 'Kết quả bài thi', exact: true }),
  ).toBeVisible();
  expect(submits).toBe(0);
});

test('leaving a page with failed answers offers retry and navigation proceeds only after saving', async ({
  page,
}) => {
  await openExam(page);
  saveError = 503;
  await page.getByRole('radio', { name: 'GET', exact: true }).check();
  await expect(page.getByTestId('save-status')).toContainText(
    'chưa lưu thành công',
  );
  await page
    .getByRole('link', { name: 'Online Examination', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('heading', { name: 'Còn đáp án chưa lưu', exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(`/exam/${examId}/take`);
  await dialog
    .getByRole('button', { name: 'Lưu rồi rời trang', exact: true })
    .click();
  await expect(page).toHaveURL('/join');
  expect(answers.get(qid(1))?.selectedOptionIds).toEqual([oid(11)]);
});

test('logout waits for autosave and a lost session blocks further edits', async ({
  page,
}) => {
  await openExam(page);
  holdSave();
  await page.getByRole('radio', { name: 'GET', exact: true }).check();
  await expect.poll(() => saveCalls.length).toBe(1);
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  expect(logouts).toBe(0);
  releaseSave!();
  await expect(page).toHaveURL('/login');
  expect(logouts).toBe(1);
  signedIn = true;
  await openExam(page);
  saveError = 401;
  await page.getByRole('radio', { name: 'POST', exact: true }).check();
  await expect(
    page.getByRole('button', { name: 'Đăng nhập lại', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('radio', { name: 'GET', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('button', { name: 'Đăng nhập lại', exact: true })
    .click();
  await expect(page).toHaveURL('/login');
});

test('mobile questions and submission dialog fit and open errors offer a clear retry', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  startError = 'ATTEMPT_LIMIT_REACHED';
  await page.goto(`/exam/${examId}/take`);
  await expect(page.getByRole('alert')).toContainText('hết số lượt');
  startError = null;
  await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Bài thi của bạn', exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('exam-mobile.png'),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole('button', { name: 'Nộp bài', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('submit-mobile.png'),
    fullPage: false,
  });
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(375);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
});

test('offline choices stay queued and resume only after a fresh rejoin without creating another attempt', async ({
  page,
  context,
}, testInfo) => {
  await openExam(page);
  await expect.poll(() => heartbeatCalls.length).toBeGreaterThan(0);
  expect(
    heartbeatCalls.every(
      (payload) => JSON.stringify(payload) === JSON.stringify({ attemptId }),
    ),
  ).toBe(true);
  const initialStarts = starts;
  const initialRejoins = rejoinCalls.length;
  const timer = await page.getByTestId('exam-timer').innerText();
  await context.setOffline(true);
  await expect(page.getByTestId('network-status')).toContainText('mất kết nối');
  await page.getByRole('radio', { name: 'POST', exact: true }).check();
  await expect(page.getByTestId('save-status')).toContainText('đang chờ gửi');
  await expect(
    page.getByRole('button', { name: 'Nộp bài', exact: true }),
  ).toBeDisabled();
  expect(saveCalls).toHaveLength(0);
  await page.screenshot({
    path: testInfo.outputPath('exam-offline.png'),
    fullPage: true,
  });
  await expect(page.getByTestId('exam-timer')).not.toHaveText(timer);
  await context.setOffline(false);
  await saved(page);
  expect(starts).toBe(initialStarts);
  expect(rejoinCalls.length).toBeGreaterThan(initialRejoins);
  expect(answers.get(qid(1))?.selectedOptionIds).toEqual([oid(12)]);
  expect(violations.some((event) => event.type === 'DISCONNECT')).toBe(false);
});

test('pending answers survive a page reload and are reconciled before replay', async ({
  page,
  context,
}) => {
  await openExam(page);
  await context.setOffline(true);
  await page.getByRole('radio', { name: 'DELETE', exact: true }).check();
  await expect(page.getByTestId('save-status')).toContainText('đang chờ gửi');
  recoverPaused = true;
  await context.setOffline(false);
  await page.reload();
  await expect(
    page.getByRole('radio', { name: 'DELETE', exact: true }),
  ).toBeChecked();
  expect(answers.size).toBe(0);
  expect(saveCalls.length).toBe(0);
  await expect.poll(() => recoverCallbacks.length).toBeGreaterThan(0);
  recoverPaused = false;
  for (const respond of recoverCallbacks.splice(0)) respond();
  await saved(page);
  expect(answers.get(qid(1))?.selectedOptionIds).toEqual([oid(13)]);
  expect(saveCalls).toHaveLength(1);
});

test('a server-closed attempt never replays offline answers and opens the confirmed result', async ({
  page,
  context,
}) => {
  await openExam(page);
  await context.setOffline(true);
  await page.getByRole('radio', { name: 'GET', exact: true }).check();
  await expect(page.getByTestId('save-status')).toContainText('đang chờ gửi');
  paper.status = 'FORCE_SUBMITTED';
  await context.setOffline(false);
  await expect(
    page.getByRole('heading', { name: 'Kết quả bài thi', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Giáo viên chốt bài', { exact: true }),
  ).toBeVisible();
  expect(saveCalls).toHaveLength(0);
  expect(submits).toBe(0);
  expect(
    await page.evaluate(
      () =>
        Object.keys(sessionStorage).filter((key) =>
          key.startsWith('oe:student:pending:'),
        ).length,
    ),
  ).toBe(0);
});

test('proctoring sends heartbeat, deduplicates hidden transitions and records actual fullscreen exits', async ({
  page,
}) => {
  await openExam(page);
  await page.evaluate(() => {
    const change = (value: DocumentVisibilityState) => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () => value,
      });
      document.dispatchEvent(new Event('visibilitychange'));
    };
    window.dispatchEvent(new Event('blur'));
    change('hidden');
    change('hidden');
    change('visible');
    change('hidden');
    change('visible');
  });
  await expect
    .poll(() => violations.filter((event) => event.type === 'TAB_BLUR').length)
    .toBe(2);
  await page
    .getByRole('button', { name: 'Vào toàn màn hình', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Đang toàn màn hình', exact: true }),
  ).toBeVisible();
  await page.evaluate(() => document.exitFullscreen());
  await expect
    .poll(
      () =>
        violations.filter((event) => event.type === 'FULLSCREEN_EXIT').length,
    )
    .toBe(1);
  expect(violations).toHaveLength(3);
  await expect(
    page.getByText(/3 sự kiện, 3 đã được máy chủ xác nhận/),
  ).toBeVisible();
  await expect(
    page.getByRole('radio', { name: 'GET', exact: true }),
  ).toBeEnabled();
  expect(submits).toBe(0);
});

test('unsupported fullscreen is explained and expired exams stop reporting browser events', async ({
  page,
}) => {
  paper = buildPaper(2, offset);
  await openExam(page);
  await page.evaluate(() =>
    Object.defineProperty(document, 'fullscreenEnabled', {
      configurable: true,
      get: () => false,
    }),
  );
  await page
    .getByRole('button', { name: 'Vào toàn màn hình', exact: true })
    .click();
  await expect(
    page.getByText('Trình duyệt hoặc thiết bị chưa hỗ trợ toàn màn hình.', {
      exact: false,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole('radio', { name: 'GET', exact: true }),
  ).toBeDisabled({ timeout: 5000 });
  await page.evaluate(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => 'hidden',
    });
    document.dispatchEvent(new Event('visibilitychange'));
  });
  expect(violations).toHaveLength(0);
  expect(submits).toBe(0);
});

test('result shows server grades immediately, conceals unpublished answers and refreshes when released', async ({
  page,
}, testInfo) => {
  await openExam(page);
  await page.getByRole('radio', { name: 'GET', exact: true }).check();
  await saved(page);
  await page.getByRole('button', { name: 'Nộp bài', exact: true }).click();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Xác nhận nộp bài', exact: true })
    .click();
  await expect(page).toHaveURL(
    `/exam/${examId}/results?attemptId=${attemptId}`,
  );
  await expect(page.getByTestId('result-score')).toHaveText('1/ 3');
  await expect(
    page.getByRole('heading', {
      name: 'Chi tiết đáp án chưa được công bố',
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText('Đáp án đúng', { exact: true })).toHaveCount(0);
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.screenshot({
    path: testInfo.outputPath('result-desktop.png'),
    fullPage: true,
  });
  const before = resultRequests;
  detailsPublished = true;
  await page
    .getByRole('button', { name: 'Tải lại kết quả', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Xem lại từng câu', exact: true }),
  ).toBeVisible();
  expect(resultRequests).toBeGreaterThan(before);
  expect(starts).toBe(1);
  expect(submits).toBe(1);
});

test('published details display server partial credit and explanations with no new attempt or editable answers', async ({
  page,
}, testInfo) => {
  paper.status = 'SUBMITTED';
  const result = buildResult(
    paper,
    new Map([
      [qid(1), { selectedOptionIds: [oid(11)] }],
      [qid(2), { selectedOptionIds: [oid(22)] }],
    ]),
    true,
  );
  result.score = 0.75;
  result.questions![0]!.earnedPoints = 0.25;
  resultOverride = result;
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto(`/exam/${examId}/results?attemptId=${attemptId}`);
  await expect(page.getByTestId('result-score')).toContainText('0,75');
  await page.getByText('Câu 2', { exact: true }).click();
  await expect(
    page.getByText('Lời giải từ server cho câu 2.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Được một phần điểm · 0,5 / 1 điểm', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('radio')).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  expect(starts).toBe(0);
  expect(saveCalls).toHaveLength(0);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('result-mobile.png'),
    fullPage: true,
  });
  await page.evaluate(() => sessionStorage.clear());
  await page.reload();
  await expect(page.getByTestId('result-score')).toContainText('0,75');
  expect(starts).toBe(0);
});

test('result errors never become zero scores or cause an attempt to be created', async ({
  page,
}) => {
  await page.goto(`/exam/${examId}/results`);
  await expect(page.getByRole('alert')).toContainText(
    'Chưa xác định được bài làm',
  );
  expect(resultRequests).toBe(0);
  expect(starts).toBe(0);
  await page.goto(`/exam/${examId}/results?attemptId=${attemptId}`);
  await expect(page.getByRole('alert')).toContainText(
    'chưa được máy chủ xác nhận đã nộp',
  );
  await expect(
    page.getByRole('link', { name: 'Tiếp tục làm bài', exact: true }),
  ).toBeVisible();
  paper.status = 'SUBMITTED';
  resultOverride = { ...buildResult(paper, answers), score: undefined };
  await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByTestId('result-score')).toHaveCount(0);
  resultOverride = {
    ...buildResult(paper, answers),
    examId: 'c9ec68a2-0000-4000-8000-000000000099',
  };
  await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('không khớp');
  resultHttpError = 403;
  await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('không có quyền');
  expect(starts).toBe(0);
  await expect(page.getByTestId('result-score')).toHaveCount(0);
});

test('reload after server closure opens the known result even when starting the attempt is rejected', async ({
  page,
  context,
}) => {
  await openExam(page);
  await context.setOffline(true);
  await page.getByRole('radio', { name: 'GET', exact: true }).check();
  recoverPaused = true;
  paper.status = 'AUTO_SUBMITTED';
  startError = 'EXAM_ENDED';
  await context.setOffline(false);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Kết quả bài thi', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Máy chủ tự chốt bài', { exact: true }),
  ).toBeVisible();
  expect(saveCalls).toHaveLength(0);
  expect(submits).toBe(0);
  expect(
    await page.evaluate(
      () =>
        Object.keys(sessionStorage).filter((key) =>
          key.startsWith('oe:student:pending:'),
        ).length,
    ),
  ).toBe(0);
});
