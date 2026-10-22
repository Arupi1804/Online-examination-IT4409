import { expect, test } from '@playwright/test';
test('client reaches the API through the development proxy', async ({
  page,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Online Examination' }),
  ).toBeVisible();
  await expect(page.getByText('API: ok', { exact: true })).toBeVisible();
});
