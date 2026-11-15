import { describe, expect, it } from 'vitest';
import { assertModuleContract } from '@ugra/testkit';
import module from '../server';

describe('тест-контракт модуля ai-vs-manual', () => {
  it('проходит контракт: id, title, README, пустые точки расширения', async () => {
    await assertModuleContract(module);
  });

  it('объявлен включённым по умолчанию и называет фичу', () => {
    expect(module.enabledByDefault).toBe(true);
    expect(module.title).toBe('С ИИ / без ИИ');
    expect(module.routes).toBeUndefined();
  });
});
