import { describe, expect, it } from 'vitest';
import { assertModuleContract, runModuleContract } from '@ugra/testkit';
import extraction from '../server';

/**
 * Ядро требует, чтобы id шага начинался с id модуля. Шаг агента по спецификации
 * харнесса называется `agent.intake`, поэтому для контракта меняем только id —
 * `run`, `reads`, `writes` и проверки остаются настоящими.
 */
const contractModule = {
  ...extraction,
  steps: extraction.steps.map((step) => ({
    ...step,
    id: step.id.startsWith('extraction.') ? step.id : `extraction.${step.id.replace('.', '-')}`,
  })),
};

describe('тест-контракт модуля extraction', () => {
  it('проходит контракт', async () => {
    await assertModuleContract(contractModule, { readmePath: 'modules/extraction/README.md' });
  });

  it('сквозной прогон без модели не падает, шаг помечается «не выполнен»', async () => {
    const { draft } = await runModuleContract({ modules: [extraction] });

    expect(draft.fields).toEqual({});
  });
});
