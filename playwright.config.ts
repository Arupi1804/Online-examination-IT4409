import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: '**/workspace.spec.ts',
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium', channel: process.env.PLAYWRIGHT_CHANNEL },
    },
  ],
  use: { baseURL: 'http://localhost:5173' },
  webServer: {
    command: 'pnpm dev',
    env: {
      CLIENT_ORIGIN: 'http://localhost:5173',
      VITE_USE_MOCK: 'false',
      VITE_API_URL: '',
      VITE_REALTIME_URL: '',
    },
    // Wait for both Vite and the API before the page makes its first request.
    url: 'http://127.0.0.1:5173/api/v1/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
