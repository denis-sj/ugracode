import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  StubLlm,
  cacheOnlyLlm,
  memoryCacheStore,
  stableStringify,
  withLlmCache,
} from '@ugra/adapters';
import type { LlmPort } from '@ugra/core';

const AnswerSchema = z.object({ answer: z.string() });

function counting(inner: LlmPort): { port: LlmPort; calls: () => number } {
  let count = 0;
  return {
    port: {
      async structured(req) {
        count += 1;
        return inner.structured(req);
      },
    },
    calls: () => count,
  };
}

describe('withLlmCache', () => {
  it('при промахе вызывает модель и кэширует, при попадании — отдаёт кэш', async () => {
    const { port, calls } = counting(new StubLlm({ p: { answer: 'ok' } }));
    const llm = withLlmCache(port, memoryCacheStore(), 'stub');
    const request = { promptId: 'p', vars: { a: 1 }, schema: AnswerSchema };

    const first = await llm.structured(request);
    const second = await llm.structured(request);

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.value).toEqual({ answer: 'ok' });
    expect(calls()).toBe(1);
  });

  it('разные переменные дают разные ключи кэша', async () => {
    const { port, calls } = counting(new StubLlm({}, { answer: 'ok' }));
    const llm = withLlmCache(port, memoryCacheStore(), 'stub');

    await llm.structured({ promptId: 'p', vars: { a: 1 }, schema: AnswerSchema });
    await llm.structured({ promptId: 'p', vars: { a: 2 }, schema: AnswerSchema });

    expect(calls()).toBe(2);
  });

  it('стабильная сериализация не зависит от порядка ключей', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: 3 } })).toBe(
      stableStringify({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });
});

describe('cacheOnlyLlm', () => {
  it('при промахе откатывается на заглушку', async () => {
    const llm = cacheOnlyLlm(memoryCacheStore(), new StubLlm({ p: { answer: 'stub' } }), 'stub');
    const result = await llm.structured({ promptId: 'p', vars: {}, schema: AnswerSchema });

    expect(result.value).toEqual({ answer: 'stub' });
    expect(result.cached).toBe(false);
  });

  it('при попадании отдаёт значение из кэша', async () => {
    const store = memoryCacheStore();
    const writer = withLlmCache(new StubLlm({ p: { answer: 'cached' } }), store, 'stub');
    const request = { promptId: 'p', vars: {}, schema: AnswerSchema };
    await writer.structured(request);

    const reader = cacheOnlyLlm(store, new StubLlm({ p: { answer: 'stub' } }), 'stub');
    const result = await reader.structured(request);

    expect(result.value).toEqual({ answer: 'cached' });
    expect(result.cached).toBe(true);
  });
});
