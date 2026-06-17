import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/*.test.ts'],
    typecheck: {
      include: ['tests/types/**/*.type-test.ts'],
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
    },
  },
});
