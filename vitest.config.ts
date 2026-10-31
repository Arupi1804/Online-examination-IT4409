import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    include: [
      'apps/server/tests/integration/**/*.test.ts',
      'packages/shared/tests/**/*.test.ts',
    ],
  },
});
