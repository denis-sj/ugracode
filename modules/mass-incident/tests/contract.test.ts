import { describe, expect, it } from 'vitest';
import type { PipelineStep } from '@ugra/core';
import { assertModuleContract, runModuleContract } from '@ugra/testkit';
import massIncident from '../server';

/**
 * Тест-контракт проверяет один модуль, а `fields` пишет другой модуль (`extraction`).
 * Подставляем фиктивного писателя полей с префиксом `mass-incident.` — сам модуль не меняется.
 */
const fieldsWriter: PipelineStep = {
  id: 'mass-incident.fixture-fields',
  title: 'Фикстура теста: поля пишет модуль extraction',
  stage: 'extract',
  order: 100,
  reads: ['sources'],
  writes: ['fields'],
  async run() {
    return {};
  },
};

const contractModule = { ...massIncident, steps: [fieldsWriter, ...massIncident.steps] };

describe('тест-контракт модуля mass-incident', () => {
  it('проходит контракт', async () => {
    await assertModuleContract(contractModule, { readmePath: 'modules/mass-incident/README.md' });
  });

  it('проходит сквозной прогон с выключением модуля', async () => {
    const { draft } = await runModuleContract({ modules: [massIncident] });
    expect(draft.incident).toBeUndefined();
  });
});
