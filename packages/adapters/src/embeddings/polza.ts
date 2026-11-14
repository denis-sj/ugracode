import OpenAI from 'openai';
import type { EmbeddingsPort } from '@ugra/core';
import { DEFAULT_POLZA_BASE_URL } from '../llm/polza';

export interface PolzaEmbeddingsOptions {
  apiKey?: string;
  baseURL?: string;
  model?: string;
  timeoutMs?: number;
}

/** Эмбеддинги через Polza (OpenAI-совместимый `embeddings`). */
export class PolzaEmbeddings implements EmbeddingsPort {
  private readonly client: OpenAI;
  private readonly model: string;

  constructor(options: PolzaEmbeddingsOptions = {}) {
    const apiKey = options.apiKey ?? process.env.POLZA_API_KEY;
    if (!apiKey) {
      throw new Error('POLZA_API_KEY не задан: эмбеддинги Polza недоступны');
    }
    this.client = new OpenAI({
      apiKey,
      baseURL: options.baseURL ?? process.env.POLZA_BASE_URL ?? DEFAULT_POLZA_BASE_URL,
      timeout: options.timeoutMs ?? 20_000,
      maxRetries: 0,
    });
    this.model = options.model ?? process.env.EMBEDDINGS_MODEL ?? 'text-embedding-3-small';
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    const response = await this.client.embeddings.create({ model: this.model, input: texts });
    return [...response.data]
      .sort((a, b) => a.index - b.index)
      .map((item) => item.embedding);
  }
}
