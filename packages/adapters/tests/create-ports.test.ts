import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { RouterAiTts, StubTts, createPorts } from '@ugra/adapters';

const MinimalSchema = z.object({ fields: z.array(z.unknown()), aspects: z.object({}) });

describe('createPorts', () => {
  it('по умолчанию собирает заглушки', async () => {
    const ports = createPorts({});

    expect(ports.aiMode).toBe('stub');
    await expect(ports.embeddings.embed(['x']).then((vectors) => vectors[0]?.length)).resolves.toBe(
      64,
    );
  });

  it('в cloud без ключа откатывается на заглушки', async () => {
    const ports = createPorts({ AI_MODE: 'cloud' });

    expect(ports.aiMode).toBe('stub');
    const result = await ports.llm.structured({
      promptId: 'x',
      vars: {},
      schema: MinimalSchema,
    });
    expect(result.model).toBe('stub');
  });

  it('без AI_MODE включает облако, если ключ задан', () => {
    const ports = createPorts({ POLZA_API_KEY: 'test-key' });
    expect(ports.aiMode).toBe('cloud');
  });

  it('явный stub сильнее ключа', () => {
    const ports = createPorts({ AI_MODE: 'stub', POLZA_API_KEY: 'test-key' });
    expect(ports.aiMode).toBe('stub');
  });

  it('без ключа RouterAI озвучка — заглушка', () => {
    const ports = createPorts({});
    expect(ports.tts).toBeInstanceOf(StubTts);
  });

  it('с ключом RouterAI озвучка облачная, режим Polza не меняется', () => {
    const ports = createPorts({ ROUTERAI_API_KEY: 'test-key' });
    expect(ports.tts).toBeInstanceOf(RouterAiTts);
    expect(ports.aiMode).toBe('stub');
  });
});
