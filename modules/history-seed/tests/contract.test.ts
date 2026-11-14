import { describe, expect, it } from 'vitest';
import { assertModuleContract } from '@ugra/testkit';
import historySeed from '../server';

describe('контракт модуля history-seed', () => {
  it('проходит тест-контракт и объявляет сид', async () => {
    await assertModuleContract(historySeed);
    expect(historySeed.seed).toBeTypeOf('function');
    expect(historySeed.enabledByDefault).toBe(false);
  });
});
