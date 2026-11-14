import { describe, expect, it } from 'vitest';
import type { PipelineStep } from '@ugra/core';
import { assertModuleContract, runModuleContract } from '@ugra/testkit';
import routing from '../server';

/**
 * Тест-контракт проверяет один модуль, а `fields` пишет другой модуль (`extraction`).
 * Чтобы проверить порядок шагов честно, подставляем фиктивного писателя полей
 * с префиксом `routing.` — сам модуль от этого не меняется.
 */
const fieldsWriter: PipelineStep = {
  id: 'routing.fixture-fields',
  title: 'Фикстура теста: поля пишет модуль extraction',
  stage: 'extract',
  order: 100,
  reads: ['sources'],
  writes: ['fields'],
  async run() {
    return {};
  },
};

const contractModule = { ...routing, steps: [fieldsWriter, ...routing.steps] };

describe('тест-контракт модуля routing', () => {
  it('проходит контракт', async () => {
    await assertModuleContract(contractModule, { readmePath: 'modules/routing/README.md' });
  });

  it('проходит сквозной прогон с выключением модуля', async () => {
    const { draft } = await runModuleContract({ modules: [routing] });
    expect(Array.isArray(draft.assignees)).toBe(true);
  });
});
