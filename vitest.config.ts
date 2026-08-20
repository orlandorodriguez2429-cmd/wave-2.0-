import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Integration tests share one database; keep them sequential.
    fileParallelism: false,
    setupFiles: ['dotenv/config'],
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
});
