import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: './tests/globalSetup.ts',
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
