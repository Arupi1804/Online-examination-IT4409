import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './apps/client/tests/e2e',
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  use: { baseURL: 'http://127.0.0.1:5173' },
  webServer: {
    command: 'pnpm dev',
    // Health through the Vite proxy: waits for both client and server.
    url: 'http://127.0.0.1:5173/api/v1/health',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
