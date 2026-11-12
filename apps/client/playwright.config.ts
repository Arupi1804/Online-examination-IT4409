import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium', channel: process.env.PLAYWRIGHT_CHANNEL },
    },
  ],
  use: { baseURL: 'http://localhost:5174' },
  webServer: {
    command: 'pnpm dev --port 5174',
    env: { VITE_USE_MOCK: 'false', VITE_API_URL: '' },
    url: 'http://localhost:5174',
    reuseExistingServer: false,
    timeout: 60000,
  },
});
