import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test.beforeEach(async ({ page }) => {
  // Contract responses belong to this frontend test. The API runs separately.
  const profile = { id: randomUUID(), email: '', name: '', role: 'STUDENT' };
  let signedIn = false;
  let registeredPassword = '';
  await page.route('**/api/v1/auth/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const unauthorized = {
      error: { code: 'AUTH_SESSION_EXPIRED', message: 'Session expired' },
    };
    if (path.endsWith('/me')) {
      await route.fulfill({
        status: signedIn ? 200 : 401,
        json: signedIn ? { data: profile } : unauthorized,
      });
      return;
    }
    if (path.endsWith('/register')) {
      const input = route.request().postDataJSON();
      profile.email = input.email;
      profile.name = input.name;
      registeredPassword = input.password;
      await route.fulfill({ status: 201, json: { data: profile } });
      return;
    }
    if (path.endsWith('/login')) {
      const input = route.request().postDataJSON();
      signedIn =
        input.email === profile.email && input.password === registeredPassword;
      await route.fulfill({
        status: signedIn ? 200 : 401,
        json: signedIn
          ? { data: profile }
          : {
              error: {
                code: 'AUTH_INVALID_CREDENTIALS',
                message: 'Invalid credentials',
              },
            },
      });
      return;
    }
    if (path.endsWith('/logout')) {
      signedIn = false;
      await route.fulfill({ status: 204 });
      return;
    }
    await route.abort();
  });
});

test('mobile form validates input and supports password visibility', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('/login?mode=register');
  const submit = page.getByRole('button', {
    name: 'Tạo tài khoản',
    exact: true,
  });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByLabel('Họ và tên', { exact: true })).toBeFocused();
  await expect(
    page.getByText('Bạn hãy nhập email.', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('Họ và tên', { exact: true }).fill('Thí sinh kiểm thử');
  await page.getByLabel('Email', { exact: true }).fill('invalid-email');
  const password = page.getByLabel('Mật khẩu', { exact: true });
  await password.fill('short');
  await page.getByLabel('Xác nhận mật khẩu', { exact: true }).fill('different');
  await submit.click();
  await expect(
    page.getByText('Mật khẩu cần từ 8 đến 72 ký tự.', { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('Mật khẩu xác nhận chưa khớp.', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Hiện mật khẩu', exact: true })
    .click();
  await expect(password).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Ẩn mật khẩu', exact: true }).click();
  await expect(password).toHaveAttribute('type', 'password');
  await expect(submit).toHaveCSS('height', '44px');
  await expect(submit).toHaveCSS('background-color', 'rgb(37, 91, 221)');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('register-mobile.png'),
    fullPage: true,
  });
});

test('auth form follows registration, login, session and logout responses', async ({
  page,
}, testInfo) => {
  const email = `week2-e2e-${randomUUID()}@example.test`;
  const password = 'Week2-test@2026';
  const name = 'Thí sinh tuần 2';
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto('/login');
  await expect(
    page.getByRole('button', { name: 'Đăng nhập', exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: testInfo.outputPath('login-desktop.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Đăng ký ngay', exact: true }).click();
  await page.getByLabel('Họ và tên', { exact: true }).fill(name);
  await page.getByLabel('Email', { exact: true }).fill(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByLabel('Xác nhận mật khẩu', { exact: true }).fill(password);
  const registered = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/v1/auth/register') &&
      response.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: 'Tạo tài khoản', exact: true })
    .click();
  const response = await registered;
  expect(response.status()).toBe(201);
  expect((await response.json()).data.role).toBe('STUDENT');
  expect(response.request().postDataJSON()).toEqual({ name, email, password });
  await expect(page.getByRole('status')).toContainText(
    'Tạo tài khoản thành công',
  );
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue(email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill('wrong-password');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Email hoặc mật khẩu chưa đúng',
  );
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/\/join$/);
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Đăng xuất', exact: true }),
  ).toBeVisible();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/join');
  await expect(page).toHaveURL(/\/login$/);
  expect(pageErrors).toEqual([]);
});
