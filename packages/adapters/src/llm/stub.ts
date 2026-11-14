import type { LlmPort, LlmRequest, LlmResult } from '@ugra/core';

/**
 * Заглушка LLM для локальной разработки и тестов.
 * Ответы задаются картой promptId → значение; иначе берётся fallback,
 * иначе — минимальный валидный ответ (пустые поля/аспекты).
 */
export class StubLlm implements LlmPort {
  private readonly responses: Record<string, unknown>;
  private readonly fallback: unknown;

  constructor(responses: Record<string, unknown> = {}, fallback?: unknown) {
    this.responses = responses;
    this.fallback = fallback;
  }

  async structured<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    const hasResponse = Object.prototype.hasOwnProperty.call(this.responses, req.promptId);
    const raw = hasResponse ? this.responses[req.promptId] : this.fallback;

    if (raw !== undefined) {
      return this.result(req.schema.parse(raw));
    }

    const minimal = this.tryMinimal(req);
    if (minimal !== undefined) {
      return this.result(minimal);
    }

    throw new Error(`Нет заглушки для промпта ${req.promptId}`);
  }

  private tryMinimal<T>(req: LlmRequest<T>): T | undefined {
    const empty = req.schema.safeParse({});
    if (empty.success) {
      return empty.data;
    }
    const shape = req.schema.safeParse({ fields: [], aspects: {} });
    if (shape.success) {
      return shape.data;
    }
    return undefined;
  }

  private result<T>(value: T): LlmResult<T> {
    return { value, model: 'stub', promptVersion: 'stub', cached: false };
  }
}
