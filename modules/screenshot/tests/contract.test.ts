import { describe, expect, it } from 'vitest';
import { assertModuleContract, runModuleContract } from '@ugra/testkit';
import screenshot from '../server';

describe('тест-контракт модуля screenshot', () => {
  it('проходит контракт', async () => {
    await assertModuleContract(screenshot, { readmePath: 'modules/screenshot/README.md' });
  });

  it('проходит сквозной прогон с выключением модуля', async () => {
    const result = await runModuleContract({ modules: [screenshot] });

    expect(result.draft.ext.screenshot).toBeUndefined();
    expect(result.draft.sources.every((source) => source.kind !== 'image')).toBe(true);
  });
});
