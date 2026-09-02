import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // integration tests share one real database and truncate it in beforeEach —
    // parallel test files would wipe each other's rows mid-test
    fileParallelism: false,
    globalSetup: './tests/globalSetup.ts',
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
