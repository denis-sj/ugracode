import { describe, expect, it } from 'vitest';
import { assertModuleContract, runModuleContract } from '@ugra/testkit';
import example from '../server';

describe('тест-контракт модуля example', () => {
  it('проходит контракт', async () => {
    await assertModuleContract(example, { readmePath: 'modules/_example/README.md' });
  });

  it('проходит сквозной прогон с выключением модуля', async () => {
    const result = await runModuleContract({ modules: [example] });
    expect(result.draft.fields.cabinet?.value).toBe('312');
  });
});
