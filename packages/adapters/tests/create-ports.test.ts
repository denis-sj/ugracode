import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createPorts } from '@ugra/adapters';

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

    expect(ports.aiMode).toBe('cloud');
    const result = await ports.llm.structured({
      promptId: 'x',
      vars: {},
      schema: MinimalSchema,
    });
    expect(result.model).toBe('stub');
  });

  it('в cache-only на промахе отдаёт заглушку', async () => {
    const ports = createPorts({ AI_MODE: 'cache-only' });
    const result = await ports.llm.structured({
      promptId: 'x',
      vars: {},
      schema: MinimalSchema,
    });

    expect(result.value).toEqual({ fields: [], aspects: {} });
    expect(result.cached).toBe(false);
  });
});
