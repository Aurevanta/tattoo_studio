import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  // TASK-0097: components are rendered in tests with the same JSX runtime Next uses.
  esbuild: { jsx: 'automatic' },
  // TASK-0099: the same `@/` alias as tsconfig, so components that use it can be rendered.
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    setupFiles: ['src/test-setup.ts'],
  },
});
