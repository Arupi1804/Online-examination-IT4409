import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

// Only the real-backend suite loads server dependencies, to clean up its own user.
const serverRequire = createRequire(
  new URL('../../../server/package.json', import.meta.url),
);
serverRequire('dotenv').config({
  path: fileURLToPath(new URL('../../../../.env', import.meta.url)),
});
test('client reaches the API through the development proxy', async ({
  page,
  request,
}) => {
  // Vite can become ready before Prisma generation and Auth bootstrap finish.
  await expect
    .poll(
      async () => {
        try {
          return (await request.get('/api/v1/health')).status();
        } catch {
          return 0;
        }
      },
      { timeout: 30_000 },
    )
    .toBe(200);
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Đăng nhập', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Email', { exact: true })).toBeVisible();
});

test('browser login JSON reaches Auth from the configured origin', async ({
  page,
}) => {
  await page.goto('/');
  const response = await page.evaluate(async (email) => {
    const result = await fetch('/api/v1/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'test-only-invalid-password' }),
    });
    return { status: result.status, body: await result.json() };
  }, `e2e-${randomUUID()}@example.test`);
  // A credential error proves browser Origin passed; no test account is created.
  expect(response.status).toBe(401);
  expect(response.body.error.code).toBe('AUTH_INVALID_CREDENTIALS');
});

test('browser login from the alternate loopback origin stays forbidden', async ({
  page,
  baseURL,
}) => {
  const alternate = new URL(baseURL!);
  alternate.hostname = '127.0.0.1';
  await page.goto(alternate.toString());
  const response = await page.evaluate(async () => {
    const result = await fetch('/api/v1/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'untrusted@example.test',
        password: 'test-only',
      }),
    });
    return { status: result.status, body: await result.json() };
  });
  expect(response.status).toBe(403);
  expect(response.body.error.code).toBe('FORBIDDEN');
});

test('student registers, restores its cookie session and logs out through the real API', async ({
  page,
  baseURL,
}) => {
  const { PrismaClient } = serverRequire('@prisma/client');
  const prisma = new PrismaClient();
  const email = `student-e2e-${randomUUID()}@example.test`;
  const password = `E2e@${randomUUID()}`;
  const name = 'Thí sinh kiểm thử hệ thống';
  try {
    await page.goto('/login?mode=register');
    await page.getByLabel('Họ và tên', { exact: true }).fill(name);
    await page.getByLabel('Email', { exact: true }).fill(email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
    await page.getByLabel('Xác nhận mật khẩu', { exact: true }).fill(password);
    await page
      .getByRole('button', { name: 'Tạo tài khoản', exact: true })
      .click();
    await expect(page.getByRole('status')).toContainText(
      'Tạo tài khoản thành công',
    );
    await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await expect(page).toHaveURL('/join');
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await page.reload();
    await expect(
      page.getByLabel('Mã phòng thi', { exact: true }),
    ).toBeVisible();
    await expect(page.getByText(name, { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
    await expect(page).toHaveURL('/login');
    await page.goto('/join');
    await expect(page).toHaveURL('/login');
  } finally {
    // Revoke any session left by a failed assertion, then delete only this UUID email.
    await page.request
      .post('/api/v1/auth/logout', {
        headers: { Origin: baseURL! },
      })
      .catch(() => undefined);
    try {
      await prisma.user.deleteMany({ where: { email } });
    } finally {
      await prisma.$disconnect();
    }
  }
});
