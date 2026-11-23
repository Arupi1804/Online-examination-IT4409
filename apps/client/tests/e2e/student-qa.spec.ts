import { expect, test, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { WS_NAMESPACE } from '@online-exam/shared';
import {
  attemptId,
  buildPaper,
  buildResult,
  examId,
  profile,
} from '../fixtures/exam-fixture';
import type {
  AttemptPaper,
  SavedAnswer,
} from '../../src/features/student/take-exam/exam-model';

// Frontend system journey: HTTP and /exam are fixtures, never the real API.
let io: Server;
let paper: AttemptPaper;
let answers: Map<string, SavedAnswer>;
let signedIn: boolean;
let status: 'SCHEDULED' | 'RUNNING';
let saveFails: boolean;
let submissions: number;
const longText = 'Nộidungkiểmthử'.repeat(18);
const longName = 'Thísinh'.repeat(12);

function clock() {
  return {
    examId,
    status,
    startTime: status === 'RUNNING' ? paper.startedAt : null,
    endTime: status === 'RUNNING' ? paper.endTime : null,
    serverTime: new Date().toISOString(),
  };
}

test.beforeAll(async () => {
  const http = createServer();
  io = new Server(http, {
    cors: { origin: 'http://localhost:5174', credentials: true },
  });
  io.of('/').use((_socket, next) => next(new Error('Use /exam namespace')));
  io.of(WS_NAMESPACE).on('connection', (socket) => {
    socket.on('room:join', (_payload, ack) => {
      ack({
        ok: true,
        data: { ...clock(), roomCode: 'K7M2QX', participantCount: 2 },
      });
    });
    socket.on('attempt:rejoin', (_payload, ack) => {
      ack({
        ok: true,
        data: {
          examId,
          attemptId,
          status: paper.status,
          submittedAt: null,
          answers: [...answers.values()].map((answer) => ({
            questionId: answer.questionId,
            optionIds: answer.selectedOptionIds,
          })),
          clock: clock(),
        },
      });
    });
    socket.on('proctor:heartbeat', (_payload, ack) =>
      ack({ ok: true, data: { serverTime: new Date().toISOString() } }),
    );
    socket.on('proctor:violation', (_payload, ack) =>
      ack({ ok: true, data: { at: new Date().toISOString() } }),
    );
  });
  await new Promise<void>((resolve, reject) => {
    http.once('error', reject);
    http.listen(5190, 'localhost', resolve);
  });
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => io.close(() => resolve()));
});

test.beforeEach(async ({ page }) => {
  io.of(WS_NAMESPACE).disconnectSockets(true);
  paper = buildPaper();
  paper.questions[0]!.content = longText;
  paper.questions[0]!.options[0]!.content = longText;
  answers = new Map();
  signedIn = false;
  status = 'SCHEDULED';
  saveFails = false;
  submissions = 0;
  const user = { ...profile, name: longName };
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith('/auth/me') && !signedIn) {
      await route.fulfill({
        status: 401,
        json: { error: { code: 'AUTH_SESSION_EXPIRED', message: 'Fixture' } },
      });
    } else if (path.endsWith('/auth/login') || path.endsWith('/auth/me')) {
      signedIn = true;
      await route.fulfill({ json: { data: user } });
    } else if (path.endsWith('/auth/logout')) {
      signedIn = false;
      await route.fulfill({ status: 204 });
    } else if (path.endsWith('/exams/join')) {
      expect(route.request().postDataJSON()).toEqual({ roomCode: 'K7M2QX' });
      await route.fulfill({
        json: {
          data: {
            ...clock(),
            roomCode: 'K7M2QX',
            title: longText,
            durationSec: 1500,
            questionCount: paper.questions.length,
            maxAttempts: 1,
            attemptsUsed: 0,
            activeAttemptId: null,
          },
        },
      });
    } else if (path === `/api/v1/exams/${examId}/attempts`) {
      await route.fulfill({
        json: { data: { ...paper, answers: [...answers.values()] } },
      });
    } else if (path.includes('/answers/')) {
      if (saveFails) {
        await route.fulfill({
          status: 503,
          json: { error: { code: 'SERVICE_UNAVAILABLE', message: 'Fixture' } },
        });
        return;
      }
      const answer = {
        questionId: path.split('/').at(-1)!,
        selectedOptionIds: route.request().postDataJSON().selectedOptionIds,
        updatedAt: new Date().toISOString(),
      };
      answers.set(answer.questionId, answer);
      await route.fulfill({ json: { data: answer } });
    } else if (path === `/api/v1/attempts/${attemptId}/submit`) {
      submissions += 1;
      paper.status = 'SUBMITTED';
      await route.fulfill({
        json: {
          data: {
            attemptId,
            examId,
            status: paper.status,
            submittedAt: new Date().toISOString(),
            score: 1,
            maxScore: 3,
          },
        },
      });
    } else if (path === `/api/v1/attempts/${attemptId}/result`) {
      await route.fulfill({
        json: {
          data: {
            ...buildResult(paper, answers, true),
            examTitle: longText,
          },
        },
      });
    } else await route.abort();
  });
});

async function fits(page: Page) {
  // Check inner containers too: overflow:hidden can conceal clipped controls.
  expect(
    await page.evaluate(() => {
      const containers = [
        document.documentElement,
        ...document.querySelectorAll(
          'main, [data-slot="card"], fieldset, dialog, button',
        ),
      ];
      return containers
        .filter((element) => element.clientWidth > 0)
        .filter((element) => element.scrollWidth > element.clientWidth + 1)
        .map((element) => ({
          tag: element.tagName,
          text: element.textContent?.slice(0, 80),
          width: element.clientWidth,
          scrollWidth: element.scrollWidth,
        }));
    }),
  ).toEqual([]);
}

async function login(page: Page) {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(profile.email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill('Test@1234');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL('/join');
}

async function startExam(page: Page) {
  await login(page);
  await page.getByLabel('Mã phòng thi', { exact: true }).fill(' k7m2qx ');
  await page
    .getByRole('button', { name: 'Vào phòng thi', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Đã vào phòng, chờ giáo viên bắt đầu' }),
  ).toBeVisible();
  status = 'RUNNING';
  io.of(WS_NAMESPACE).emit('exam:started', clock());
  await expect(
    page.getByRole('heading', { name: 'Bài thi của bạn' }),
  ).toBeVisible();
  await expect(
    page.getByText('Đang đồng bộ thời gian', { exact: true }),
  ).toBeVisible();
}

for (const viewport of [
  { width: 320, height: 640 },
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
]) {
  test(`QA-UI-${viewport.width}: login, waiting, answers, results and logout fit with long content`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setViewportSize(viewport);
    await login(page);
    await fits(page);
    await page.getByLabel('Mã phòng thi', { exact: true }).fill(' k7m2qx ');
    await page
      .getByRole('button', { name: 'Vào phòng thi', exact: true })
      .click();
    await expect(
      page.getByRole('heading', {
        name: 'Đã vào phòng, chờ giáo viên bắt đầu',
      }),
    ).toBeVisible();
    await fits(page);
    await page.screenshot({
      path: testInfo.outputPath('waiting.png'),
      fullPage: true,
    });
    status = 'RUNNING';
    io.of(WS_NAMESPACE).emit('exam:started', clock());
    await expect(page.getByRole('radio').first()).toBeVisible();
    await expect(
      page.getByText('Đang đồng bộ thời gian', { exact: true }),
    ).toBeVisible();
    await fits(page);
    await page.getByRole('radio').first().check();
    await expect(page.getByTestId('save-status')).toHaveText(
      'Mọi thay đổi đã được lưu',
    );
    if (viewport.width < 1024) {
      await page
        .getByRole('button', { name: 'Đến danh sách câu hỏi', exact: true })
        .click();
      await expect(
        page.getByRole('navigation', { name: 'Điều hướng câu hỏi' }),
      ).toBeFocused();
    }
    const questionButtons = page
      .getByRole('navigation', { name: 'Điều hướng câu hỏi' })
      .getByRole('button');
    for (const button of await questionButtons.all()) {
      const box = await button.boundingBox();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }
    await questionButtons.nth(1).click();
    await expect(
      page.getByRole('heading', { name: 'Câu 2 / 3' }),
    ).toBeFocused();
    const questionBox = await page
      .getByRole('heading', { name: 'Câu 2 / 3' })
      .boundingBox();
    const timerBox = await page.getByRole('timer').boundingBox();
    expect(questionBox!.y).toBeGreaterThanOrEqual(
      timerBox!.y + timerBox!.height,
    );
    await page.getByRole('checkbox', { name: '200 OK', exact: true }).check();
    await expect(page.getByTestId('save-status')).toHaveText(
      'Mọi thay đổi đã được lưu',
    );
    await page
      .getByRole('button', { name: 'Đánh dấu câu', exact: true })
      .click();
    await page.getByRole('button', { name: 'Câu tiếp', exact: true }).click();
    await page.getByRole('radio', { name: 'Đúng', exact: true }).check();
    await expect(page.getByTestId('save-status')).toHaveText(
      'Mọi thay đổi đã được lưu',
    );
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath('exam.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Nộp bài', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Nộp bài thi?' });
    await fits(page);
    await dialog
      .getByRole('button', { name: 'Xác nhận nộp bài', exact: true })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Kết quả bài thi' }),
    ).toBeVisible();
    await fits(page);
    await page.locator('summary').first().click();
    await expect(
      page.getByText('Lời giải từ server cho câu 1.', { exact: true }),
    ).toBeVisible();
    await fits(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({
      path: testInfo.outputPath('results.png'),
      fullPage: true,
    });
    expect(submissions).toBe(1);
    await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
    await expect(page).toHaveURL('/login');
    await page.goto('/join');
    await expect(page).toHaveURL('/login');
    expect(errors).toEqual([]);
  });
}

test('QA-KEYBOARD: skip navigation, answer controls and safe modal focus work with the keyboard', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page);
  await page.reload();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('link', { name: 'Đến nội dung chính' }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  const code = page.getByLabel('Mã phòng thi', { exact: true });
  await code.focus();
  await page.keyboard.type('K7M2QX');
  await page.keyboard.press('Enter');
  await expect(
    page.getByRole('heading', { name: 'Đã vào phòng, chờ giáo viên bắt đầu' }),
  ).toBeVisible();
  status = 'RUNNING';
  io.of(WS_NAMESPACE).emit('exam:started', clock());
  const radio = page.getByRole('radio').first();
  await radio.focus();
  await page.keyboard.press('Space');
  await expect(radio).toBeChecked();
  await expect(page.getByTestId('save-status')).toHaveText(
    'Mọi thay đổi đã được lưu',
  );
  const submit = page.getByRole('button', { name: 'Nộp bài', exact: true });
  await expect(submit).toBeEnabled();
  await submit.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  const cancel = dialog.getByRole('button', {
    name: 'Tiếp tục làm bài',
    exact: true,
  });
  const confirm = dialog.getByRole('button', {
    name: 'Xác nhận nộp bài',
    exact: true,
  });
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(confirm).toBeFocused();
  // showModal makes the background inert, including programmatic focus.
  await submit.focus();
  await expect(confirm).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(cancel).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(submit).toBeFocused();
  expect(submissions).toBe(0);
});

test('QA-DIALOG: failed-answer exit and submit dialogs fit narrow and landscape screens', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await startExam(page);
  saveFails = true;
  await page.getByRole('radio').first().check();
  await expect(page.getByTestId('save-status')).toContainText(
    '1 câu chưa lưu thành công',
  );
  await page
    .getByRole('link', { name: 'Online Examination', exact: true })
    .click();
  const unsaved = page.getByRole('dialog', { name: 'Còn đáp án chưa lưu' });
  await expect(unsaved).toBeVisible();
  await fits(page);
  const leave = unsaved.getByRole('button', {
    name: 'Rời trang, bỏ thay đổi chưa lưu',
    exact: true,
  });
  const leaveBox = await leave.boundingBox();
  expect(leaveBox!.x).toBeGreaterThanOrEqual(0);
  expect(leaveBox!.x + leaveBox!.width).toBeLessThanOrEqual(320);
  await page.keyboard.press('Escape');
  await expect(unsaved).toHaveCount(0);
  await expect(page.getByRole('radio').first()).toBeChecked();
  saveFails = false;
  await page.getByRole('button', { name: 'Nộp bài', exact: true }).click();
  await page.setViewportSize({ width: 640, height: 320 });
  const submitDialog = page.getByRole('dialog', { name: 'Nộp bài thi?' });
  await expect(submitDialog).toBeVisible();
  await fits(page);
  const bounds = await submitDialog.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(320);
  await submitDialog
    .getByRole('button', { name: 'Thử lưu lại', exact: true })
    .click();
  const confirm = submitDialog.getByRole('button', {
    name: 'Xác nhận nộp bài',
    exact: true,
  });
  await expect(confirm).toBeEnabled();
  await confirm.scrollIntoViewIfNeeded();
  await expect(confirm).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('submit-landscape.png') });
  await confirm.click();
  await expect(
    page.getByRole('heading', { name: 'Kết quả bài thi' }),
  ).toBeVisible();
  expect(submissions).toBe(1);
});

test('QA-TEXT: registration errors and exam controls fit with doubled text and reduced motion', async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  // Resize text without altering CSS breakpoints or hiding overflowing content.
  await page.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => {
      document.documentElement.style.fontSize = '200%';
    });
  });
  await page.goto('/login?mode=register');
  await page
    .getByRole('button', { name: 'Tạo tài khoản', exact: true })
    .click();
  await expect(page.getByLabel('Họ và tên', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute(
    'aria-describedby',
    'email-error',
  );
  await fits(page);
  await startExam(page);
  await fits(page);
  await page.getByRole('button', { name: 'Nộp bài', exact: true }).click();
  await fits(page);
  await page
    .getByRole('button', { name: 'Tiếp tục làm bài', exact: true })
    .click();
  expect(submissions).toBe(0);
});
