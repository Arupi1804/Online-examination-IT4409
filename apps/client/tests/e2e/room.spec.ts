import { expect, test, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { buildPaper } from '../fixtures/exam-fixture';

// A protocol fixture owned by the frontend tests, not the project's backend.
const examId = 'c9ec68a2-0000-4000-8000-000000000001';
const profile = {
  id: '96ed2849-40c0-4e85-85d4-a85f3aff1f01',
  name: 'Thí sinh tuần 3',
  email: 'student1@test.com',
  role: 'STUDENT',
};
let io: Server;
let status: 'SCHEDULED' | 'RUNNING' | 'ENDED';
let participantCount: number;
let rejectedCode: string | null;
let silentJoin: boolean;
let joins: unknown[];
let restRequests: string[];
let signedIn: boolean;

function clock() {
  return {
    examId,
    status,
    startTime: status === 'SCHEDULED' ? null : new Date().toISOString(),
    endTime:
      status === 'SCHEDULED'
        ? null
        : new Date(Date.now() + 2700000).toISOString(),
    serverTime: new Date().toISOString(),
  };
}

test.beforeAll(async () => {
  const http = createServer();
  io = new Server(http, {
    cors: { origin: 'http://localhost:5174', credentials: true },
  });
  io.on('connection', (socket) => {
    socket.on(
      'room:join',
      (payload: unknown, ack: (value: unknown) => void) => {
        joins.push(payload);
        if (silentJoin) return;
        if (rejectedCode) {
          ack({
            ok: false,
            error: { code: rejectedCode, message: 'Fixture rejection' },
          });
          return;
        }
        const state = { ...clock(), roomCode: 'K7M2QX', participantCount };
        socket.emit('room:state', state);
        ack({ ok: true, data: state });
      },
    );
  });
  await new Promise<void>((resolve) => http.listen(5190, 'localhost', resolve));
});

test.afterAll(async () => {
  await new Promise<void>((resolve) => io.close(() => resolve()));
});

test.beforeEach(async ({ page }) => {
  io.disconnectSockets(true);
  status = 'SCHEDULED';
  participantCount = 4;
  rejectedCode = null;
  silentJoin = false;
  joins = [];
  restRequests = [];
  signedIn = true;
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    restRequests.push(path);
    if (path === '/api/v1/auth/me') {
      await route.fulfill({
        status: signedIn ? 200 : 401,
        json: signedIn
          ? { data: profile }
          : { error: { code: 'AUTH_SESSION_EXPIRED', message: 'Expired' } },
      });
    } else if (path === '/api/v1/auth/logout') {
      signedIn = false;
      await route.fulfill({ status: 204 });
    } else if (path === `/api/v1/exams/${examId}/attempts`) {
      await route.fulfill({ json: { data: buildPaper(2700) } });
    } else if (path === '/api/v1/exams/join') {
      const body = route.request().postDataJSON();
      expect(Object.keys(body)).toEqual(['roomCode']);
      if (body.roomCode !== 'K7M2QX' || status === 'ENDED') {
        await route.fulfill({
          status: status === 'ENDED' ? 422 : 404,
          json: {
            error: {
              code: status === 'ENDED' ? 'EXAM_ENDED' : 'ROOM_NOT_FOUND',
              message: 'Fixture',
            },
          },
        });
      } else {
        await route.fulfill({
          json: {
            data: {
              ...clock(),
              title: 'Kiểm tra Công nghệ Web',
              durationSec: 2700,
              questionCount: 30,
              maxAttempts: 1,
              attemptsUsed: 0,
              activeAttemptId: null,
            },
          },
        });
      }
    } else {
      await route.abort();
    }
  });
});

async function joinRoom(page: Page) {
  await page.goto('/join');
  await page.getByLabel('Mã phòng thi', { exact: true }).fill(' k7m2qx ');
  await page
    .getByRole('button', { name: 'Vào phòng thi', exact: true })
    .click();
  await expect(page).toHaveURL(`/exam/${examId}/waiting`);
  await expect(
    page.getByRole('heading', { name: 'Đã vào phòng, chờ giáo viên bắt đầu' }),
  ).toBeVisible();
}

test('mobile join validates codes, explains missing/ended rooms and prevents overflow', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/join');
  const submit = page.getByRole('button', {
    name: 'Vào phòng thi',
    exact: true,
  });
  const input = page.getByLabel('Mã phòng thi', { exact: true });
  await submit.click();
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute('aria-invalid', 'true');
  await input.fill('K7M2Q0');
  await submit.click();
  await expect(
    page.getByText('Mã phòng gồm 6 ký tự', { exact: false }),
  ).toBeVisible();
  expect(
    restRequests.filter((path) => path.endsWith('/exams/join')),
  ).toHaveLength(0);
  await input.fill('ZZZZZZ');
  await submit.click();
  await expect(page.getByRole('alert')).toContainText(
    'Không tìm thấy phòng thi',
  );
  status = 'ENDED';
  await input.fill('K7M2QX');
  await submit.click();
  await expect(page.getByRole('alert')).toContainText('Kỳ thi đã kết thúc');
  status = 'SCHEDULED';
  await input.fill('K7M2QX');
  await page.screenshot({
    path: testInfo.outputPath('join-mobile.png'),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});

test('room restores after reload, refreshes authoritative counts and starts only on matching events', async ({
  page,
}, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/join');
  await expect(
    page.getByRole('heading', { name: 'Vào phòng thi', exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('join-desktop.png'),
    fullPage: true,
  });
  await joinRoom(page);
  await expect(page.getByTestId('participant-count')).toHaveText('4 kết nối');
  await expect(page.getByText('45 phút', { exact: true })).toBeVisible();
  await expect(page.getByText('30 câu', { exact: true })).toBeVisible();
  expect(
    joins.every(
      (payload) =>
        JSON.stringify(payload) === JSON.stringify({ roomCode: 'K7M2QX' }),
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('waiting-desktop.png'),
    fullPage: true,
  });
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Đã vào phòng, chờ giáo viên bắt đầu' }),
  ).toBeVisible();
  participantCount = 6;
  io.emit('participant:joined', {
    examId,
    userId: '96ed2849-40c0-4e85-85d4-a85f3aff1f02',
    role: 'STUDENT',
  });
  await expect(page.getByTestId('participant-count')).toHaveText('6 kết nối', {
    timeout: 10000,
  });
  status = 'RUNNING';
  io.emit('exam:started', {
    ...clock(),
    examId: 'c9ec68a2-0000-4000-8000-000000000099',
  });
  await expect(page).toHaveURL(`/exam/${examId}/waiting`);
  io.emit('exam:started', clock());
  await expect(page).toHaveURL(`/exam/${examId}/take`);
  await expect(
    page.getByRole('heading', { name: 'Bài thi của bạn', exact: true }),
  ).toBeVisible();
  expect(restRequests.some((path) => path.endsWith('/attempts'))).toBe(true);
  await page
    .getByRole('link', { name: 'Online Examination', exact: true })
    .click();
  await expect.poll(() => io.engine.clientsCount).toBe(0);
  expect(pageErrors).toEqual([]);
});

test('mobile waiting fits the viewport and leaving disconnects the room', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await joinRoom(page);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('waiting-mobile.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Rời phòng', exact: true }).click();
  await expect(page).toHaveURL('/join');
  await expect.poll(() => io.engine.clientsCount).toBe(0);
  await page.goto(`/exam/${examId}/waiting`);
  await expect(page.getByRole('alert')).toContainText('Bạn chưa vào phòng này');
});

test('transport reconnect rejoins and recovers a start event missed while disconnected', async ({
  page,
}) => {
  await joinRoom(page);
  const previousJoins = joins.length;
  participantCount = 5;
  io.emit('participant:joined', {
    examId,
    userId: profile.id,
    role: 'STUDENT',
  });
  for (const socket of io.sockets.sockets.values()) socket.conn.close();
  await expect.poll(() => joins.length).toBeGreaterThan(previousJoins);
  await expect(page.getByTestId('participant-count')).toHaveText('5 kết nối');
  participantCount = 3;
  io.emit('participant:left', { examId, userId: profile.id, role: 'STUDENT' });
  await expect(page.getByTestId('participant-count')).toHaveText('3 kết nối', {
    timeout: 10000,
  });
  const restoredJoins = joins.length;
  status = 'RUNNING';
  for (const socket of io.sockets.sockets.values()) socket.conn.close();
  await expect(page).toHaveURL(`/exam/${examId}/take`, { timeout: 15000 });
  expect(joins.length).toBeGreaterThan(restoredJoins);
});

test('arriving after the exam starts enters the take route after realtime confirmation', async ({
  page,
}) => {
  status = 'RUNNING';
  await page.goto('/join');
  await page.getByLabel('Mã phòng thi', { exact: true }).fill('K7M2QX');
  await page
    .getByRole('button', { name: 'Vào phòng thi', exact: true })
    .click();
  await expect(page).toHaveURL(`/exam/${examId}/take`);
  expect(joins.length).toBeGreaterThan(0);
  await expect(
    page.getByRole('heading', { name: 'Bài thi của bạn', exact: true }),
  ).toBeVisible();
  expect(restRequests.some((path) => path.endsWith('/attempts'))).toBe(true);
  await page
    .getByRole('link', { name: 'Online Examination', exact: true })
    .click();
  await expect.poll(() => io.engine.clientsCount).toBe(0);
});

test('room end stays in a closed waiting room and a replaced session returns to login', async ({
  page,
}) => {
  await joinRoom(page);
  status = 'ENDED';
  io.emit('exam:ended', clock());
  await expect(
    page.getByRole('heading', { name: 'Kỳ thi đã kết thúc', exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(`/exam/${examId}/waiting`);
  signedIn = false;
  io.emit('session:replaced', { reason: 'SESSION_REPLACED' });
  await expect(page.getByRole('alert')).toContainText('được thay thế');
  await page
    .getByRole('button', { name: 'Đăng nhập lại', exact: true })
    .click();
  await expect(page).toHaveURL('/login');
  await expect.poll(() => io.engine.clientsCount).toBe(0);
});

test('room ACK rejection and timeout allow a deliberate retry without leaking connections', async ({
  page,
}) => {
  rejectedCode = 'FORBIDDEN';
  await page.goto('/join');
  await page.getByLabel('Mã phòng thi', { exact: true }).fill('K7M2QX');
  await page
    .getByRole('button', { name: 'Vào phòng thi', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('không có quyền');
  rejectedCode = null;
  silentJoin = true;
  await page
    .getByRole('button', { name: 'Thử kết nối lại', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('chưa phản hồi', {
    timeout: 15000,
  });
  silentJoin = false;
  await page
    .getByRole('button', { name: 'Thử kết nối lại', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Đã vào phòng, chờ giáo viên bắt đầu' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await expect(page).toHaveURL('/login');
  await expect.poll(() => io.engine.clientsCount).toBe(0);
});
