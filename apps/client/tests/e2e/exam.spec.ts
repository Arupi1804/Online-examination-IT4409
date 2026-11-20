import { expect, test, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import {
  buildPaper,
  examId,
  attemptId,
  oid,
  qid,
  profile,
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
  io.on('connection', (socket) =>
    socket.on('room:join', (payload, ack) => {
      expect(payload).toEqual({ examId });
      ack({
        ok: true,
        data: { ...clock(), roomCode: 'K7M2QX', participantCount: 1 },
      });
    }),
  );
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
  io.disconnectSockets(true);
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
            score: 2,
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
    page.getByRole('heading', { name: 'Đã nộp bài', exact: true }),
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
  io.emit('exam:extended', clock());
  await expect(
    page.getByRole('radio', { name: 'GET', exact: true }),
  ).toBeEnabled();
  io.emit('exam:ended', clock('ENDED'));
  await expect(
    page.getByRole('radio', { name: 'GET', exact: true }),
  ).toBeDisabled();
  io.emit('attempt:submitted', {
    examId,
    attemptId: 'd1000000-0000-4000-8000-000000000099',
    status: 'AUTO_SUBMITTED',
    submittedAt: new Date().toISOString(),
  });
  await expect(
    page.getByRole('heading', { name: 'Đã nộp bài', exact: true }),
  ).toHaveCount(0);
  io.emit('attempt:submitted', {
    examId,
    attemptId,
    status: 'AUTO_SUBMITTED',
    submittedAt: new Date().toISOString(),
  });
  await expect(
    page.getByRole('heading', { name: 'Đã nộp bài', exact: true }),
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
