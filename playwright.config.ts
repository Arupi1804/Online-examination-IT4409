import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './apps/client/tests/e2e',
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  use: { baseURL: 'http://127.0.0.1:5173' },
  webServer: {
    command: 'pnpm dev',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
