import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Unit fixtures must be independent of a developer's .env.local backend URL.
  define: { 'import.meta.env.VITE_API_URL': JSON.stringify('') },
  test: { include: ['tests/*.test.ts'] },
});
