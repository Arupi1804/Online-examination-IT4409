import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './apps/client/tests/e2e',
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  use: { baseURL: 'http://localhost:5173' },
  webServer: {
    command: 'pnpm dev',
    env: { CLIENT_ORIGIN: 'http://localhost:5173' },
    // Wait for both Vite and the API before the page makes its first request.
    url: 'http://127.0.0.1:5173/api/v1/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
