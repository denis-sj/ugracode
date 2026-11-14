import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { StubLlm } from '@ugra/adapters';

const AnswerSchema = z.object({ answer: z.string() });

describe('StubLlm', () => {
  it('возвращает ответ из карты по promptId', async () => {
    const llm = new StubLlm({ 'test.prompt': { answer: 'готово' } });
    const result = await llm.structured({
      promptId: 'test.prompt',
      vars: {},
      schema: AnswerSchema,
    });

    expect(result.value).toEqual({ answer: 'готово' });
    expect(result.model).toBe('stub');
    expect(result.promptVersion).toBe('stub');
    expect(result.cached).toBe(false);
  });

  it('использует fallback, если ответа для промпта нет', async () => {
    const llm = new StubLlm({}, { answer: 'fallback' });
    const result = await llm.structured({
      promptId: 'unknown',
      vars: {},
      schema: AnswerSchema,
    });

    expect(result.value).toEqual({ answer: 'fallback' });
  });

  it('строит минимальный ответ для схемы полей и аспектов', async () => {
    const schema = z.object({
      fields: z.array(z.string()),
      aspects: z.object({}),
    });
    const llm = new StubLlm();
    const result = await llm.structured({ promptId: 'extract', vars: {}, schema });

    expect(result.value).toEqual({ fields: [], aspects: {} });
  });

  it('бросает ошибку, если заглушки нет и минимальный ответ не подходит', async () => {
    const llm = new StubLlm();

    await expect(
      llm.structured({ promptId: 'missing.prompt', vars: {}, schema: AnswerSchema }),
    ).rejects.toThrow('Нет заглушки для промпта missing.prompt');
  });

  it('бросает ошибку схемы на невалидный ответ', async () => {
    const llm = new StubLlm({ bad: { answer: 42 } });

    await expect(
      llm.structured({ promptId: 'bad', vars: {}, schema: AnswerSchema }),
    ).rejects.toBeInstanceOf(z.ZodError);
  });
});
