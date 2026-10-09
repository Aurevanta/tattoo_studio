import { defineConfig } from 'vitest/config';

export default defineConfig({
  // TASK-0097: components are rendered in tests with the same JSX runtime Next uses.
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['src/test-setup.ts'],
  },
});
