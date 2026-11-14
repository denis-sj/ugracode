import { describe, expect, it } from 'vitest';
import { assertModuleContract, runModuleContract } from '@ugra/testkit';
import knowledge from '../server';

describe('тест-контракт модуля knowledge', () => {
  it('проходит контракт', async () => {
    await assertModuleContract(knowledge, { readmePath: 'modules/knowledge/README.md' });
  });

  it('проходит сквозной прогон с выключением модуля', async () => {
    const { draft } = await runModuleContract({ modules: [knowledge] });
    expect(draft.sources.length).toBeGreaterThan(0);
  });
});
