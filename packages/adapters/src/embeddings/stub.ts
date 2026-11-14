import { createHash } from 'node:crypto';
import type { EmbeddingsPort } from '@ugra/core';

export const STUB_EMBEDDING_DIM = 64;

/** Детерминированный хэш-вектор: одинаковый текст → одинаковый вектор. */
export class StubEmbeddings implements EmbeddingsPort {
  constructor(private readonly dim: number = STUB_EMBEDDING_DIM) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.vector(text));
  }

  private vector(text: string): number[] {
    const bytes: number[] = [];
    let seed = text;
    while (bytes.length < this.dim) {
      const digest = createHash('sha256').update(seed).digest();
      for (const byte of digest) {
        bytes.push(byte);
      }
      seed = `${text}#${bytes.length}`;
    }
    const raw = bytes.slice(0, this.dim).map((byte) => byte - 127.5);
    const norm = Math.sqrt(raw.reduce((sum, value) => sum + value * value, 0)) || 1;
    return raw.map((value) => value / norm);
  }
}
