import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** Запрещённые группы импортов по слоям (раздел 1.2 спецификации). */
const LAYER_MESSAGE = 'Нарушено направление зависимостей: apps → modules → adapters, db → core → contracts';

/** Запрещает пакет целиком; `exact` — только точный путь (разрешает подпути вроде @ugra/core/web). */
const forbidden = (pkgs, allowedSubpaths = []) => ({
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        ...pkgs.map((p) => `${p}/*`),
        ...pkgs,
        ...allowedSubpaths.map((p) => `!${p}`),
      ].map((group) => ({ group: [group], message: LAYER_MESSAGE })),
    },
  ],
});

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', 'coverage/**', '**/*.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-console': ['warn', { allow: ['error', 'warn', 'info'] }],
      eqeqeq: ['error', 'always'],
    },
  },
  {
    files: ['packages/contracts/**/*.ts'],
    rules: forbidden(['@ugra/core', '@ugra/adapters', '@ugra/db', '@ugra/testkit', 'fastify', 'react']),
  },
  {
    files: ['packages/core/**/*.ts'],
    rules: forbidden(['@ugra/adapters', '@ugra/db', '@ugra/testkit', '@ugra/ui', 'fastify', 'react']),
  },
  {
    files: ['packages/adapters/**/*.ts', 'packages/db/**/*.ts'],
    rules: forbidden(['@ugra/testkit', '@ugra/ui', 'react', 'fastify']),
  },
  {
    files: ['modules/**/*.ts'],
    rules: forbidden(['fastify']),
  },
  {
    files: ['modules/**/web/**/*.ts', 'modules/**/web/**/*.tsx'],
    // @ugra/core/web разрешён: это браузерная точка входа ядра.
    rules: forbidden(['@ugra/db', '@ugra/adapters', '@ugra/testkit']),
  },
  {
    files: ['apps/web/**/*.ts', 'apps/web/**/*.tsx'],
    rules: forbidden(['@ugra/db', '@ugra/adapters', '@ugra/testkit', 'fastify', 'pg', 'openai']),
  },
  {
    files: ['packages/db/src/migrate.ts', 'packages/db/src/seed/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    files: ['scripts/**/*.ts', '**/*.test.ts', 'packages/testkit/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
);
