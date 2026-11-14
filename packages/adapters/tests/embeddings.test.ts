import { describe, expect, it } from 'vitest';
import { STUB_EMBEDDING_DIM, StubEmbeddings } from '@ugra/adapters';

function norm(vector: number[]): number {
  return Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
}

describe('StubEmbeddings', () => {
  const embeddings = new StubEmbeddings();

  it('детерминирован: одинаковый текст → одинаковый вектор', async () => {
    const [first] = await embeddings.embed(['принтер не печатает']);
    const [second] = await embeddings.embed(['принтер не печатает']);

    expect(first).toEqual(second);
    expect(first).toHaveLength(STUB_EMBEDDING_DIM);
  });

  it('разные тексты дают разные векторы', async () => {
    const [first, second] = await embeddings.embed(['принтер', 'монитор']);

    expect(first).not.toEqual(second);
  });

  it('вектор нормализован к единичной длине', async () => {
    const [vector] = await embeddings.embed(['кабинет 312']);

    expect(vector).toBeDefined();
    expect(norm(vector as number[])).toBeCloseTo(1, 5);
  });

  it('возвращает вектор на каждый текст', async () => {
    const vectors = await embeddings.embed(['а', 'б', 'в']);

    expect(vectors).toHaveLength(3);
  });
});
