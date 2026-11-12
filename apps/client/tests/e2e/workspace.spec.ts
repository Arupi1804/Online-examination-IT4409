import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
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
    page.getByRole('heading', { name: 'Online Examination' }),
  ).toBeVisible();
  await expect(page.getByText('API: ok', { exact: true })).toBeVisible();
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
