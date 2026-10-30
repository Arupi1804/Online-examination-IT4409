import { expect, test } from '@playwright/test';
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
