import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // Realtime fixtures share a local port and are isolated by test file.
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium', channel: process.env.PLAYWRIGHT_CHANNEL },
    },
  ],
  use: {
    baseURL: 'http://localhost:5174',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command:
      'pnpm --filter @online-exam/shared build && pnpm --filter @online-exam/client dev --port 5174',
    env: {
      VITE_USE_MOCK: 'false',
      VITE_API_URL: '',
      VITE_REALTIME_URL: 'http://localhost:5190',
    },
    url: 'http://localhost:5174',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
