import { defineConfig } from 'vitest/config';
export default defineConfig({
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('') },
  test: {
    include: [
      'apps/server/tests/**/*.test.ts',
      'packages/shared/tests/**/*.test.ts',
      'apps/client/tests/*.test.ts',
    ],
  },
});
