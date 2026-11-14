import { describe, expect, it } from 'vitest';
import { assertModuleContract, runModuleContract } from '@ugra/testkit';
import quality from '../server';

describe('тест-контракт модуля quality', () => {
  it('проходит контракт', async () => {
    await assertModuleContract(quality, { readmePath: 'modules/quality/README.md' });
  });

  it('проходит сквозной прогон с выключением модуля', async () => {
    const { draft } = await runModuleContract({ modules: [quality] });
    expect(draft.sources.length).toBeGreaterThan(0);
  });
});
