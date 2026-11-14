import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PipelineStep } from '@ugra/core';
import { createReferenceData } from '@ugra/core';
import { assertModuleContract, runModuleContract } from '@ugra/testkit';
import priority from '../server';
import { PriorityMatrix } from '../contracts';

const matrix = PriorityMatrix.parse(
  JSON.parse(readFileSync(join(process.cwd(), 'data/priority-matrix.json'), 'utf8')),
);

/** Поля в тест-контракте пишет модуль `extraction`; для проверки порядка подставляем фикстуру. */
const fieldsWriter: PipelineStep = {
  id: 'priority.fixture-fields',
  title: 'Фикстура теста: поля пишет модуль extraction',
  stage: 'extract',
  order: 100,
  reads: ['sources'],
  writes: ['fields'],
  async run() {
    return {};
  },
};

const contractModule = { ...priority, steps: [fieldsWriter, ...priority.steps] };

describe('тест-контракт модуля priority', () => {
  it('проходит контракт', async () => {
    await assertModuleContract(contractModule, { readmePath: 'modules/priority/README.md' });
  });

  it('проходит сквозной прогон с выключением модуля', async () => {
    const { draft } = await runModuleContract({
      modules: [priority],
      referenceData: createReferenceData({ extra: { priorityMatrix: matrix } }),
    });

    expect(draft.priority?.value).toBe('medium');
  });
});
