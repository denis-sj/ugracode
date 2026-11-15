import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const alias = (pkg: string): string => fileURLToPath(new URL(`./${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      'react-dom': fileURLToPath(new URL('./apps/web/node_modules/react-dom', import.meta.url)),
      react: fileURLToPath(new URL('./apps/web/node_modules/react', import.meta.url)),
      '@ugra/contracts': alias('packages/contracts'),
      '@ugra/core': alias('packages/core'),
      '@ugra/adapters': alias('packages/adapters'),
      '@ugra/db': alias('packages/db'),
      '@ugra/testkit': alias('packages/testkit'),
      '@ugra/ui': alias('packages/ui'),
    },
  },
  test: {
    include: ['packages/**/tests/**/*.test.ts', 'modules/**/tests/**/*.test.ts', 'apps/**/tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 15000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: 'coverage',
      // Меряем серверную логику: API, ядро/адаптеры/база и серверные части модулей.
      include: [
        'apps/api/src/**/*.ts',
        'packages/contracts/src/**/*.ts',
        'packages/core/src/**/*.ts',
        'packages/adapters/src/**/*.ts',
        'packages/db/src/**/*.ts',
        'modules/*/server/**/*.ts',
      ],
      exclude: [
        '**/*.test.ts',
        '**/tests/**',
        '**/prompts/**',
        'packages/db/src/seed/**',
        'packages/db/src/migrate.ts',
        'modules/*/server/index.ts',
      ],
      thresholds: {
        lines: 60,
        statements: 60,
        functions: 60,
        branches: 50,
      },
    },
  },
});
