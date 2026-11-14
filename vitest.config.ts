import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const alias = (pkg: string): string => fileURLToPath(new URL(`./${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
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
  },
});
