import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/http/**/*.test.ts', 'tests/db/**/*.test.ts'],
    // tests/db 需要真實 PostgreSQL（TEST_DATABASE_URL；未提供時走 Testcontainers，冷啟動較久）
    testTimeout: 30_000,
    hookTimeout: 180_000,
  },
});
