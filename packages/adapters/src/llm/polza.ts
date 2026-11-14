import OpenAI from 'openai';
import { toJsonSchema } from '@ugra/contracts';
import type { LlmPort, LlmRequest, LlmResult } from '@ugra/core';

export const DEFAULT_POLZA_BASE_URL = 'https://api.polza.ai/api/v1';

export interface PolzaLlmOptions {
  apiKey?: string;
  baseURL?: string;
  modelMain?: string;
  modelCheap?: string;
  /** Таймаут одного запроса, мс. По умолчанию 20 000. */
  timeoutMs?: number;
}

function textFromCompletion(completion: OpenAI.Chat.ChatCompletion): string {
  const content = completion.choices[0]?.message?.content;
  return typeof content === 'string' ? content : '';
}

function parseJson(text: string): unknown {
  return JSON.parse(text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
}

/**
 * Реальный LLM-адаптер через облачный провайдер Polza (OpenAI-совместимый API).
 * Импортировать явно: без AI_MODE=cloud и ключа он не нужен.
 */
export class PolzaLlm implements LlmPort {
  private readonly client: OpenAI;
  private readonly modelMain: string;
  private readonly modelCheap: string;

  constructor(options: PolzaLlmOptions = {}) {
    const apiKey = options.apiKey ?? process.env.POLZA_API_KEY;
    if (!apiKey) {
      throw new Error('POLZA_API_KEY не задан: LLM Polza недоступен');
    }
    this.client = new OpenAI({
      apiKey,
      baseURL: options.baseURL ?? process.env.POLZA_BASE_URL ?? DEFAULT_POLZA_BASE_URL,
      timeout: options.timeoutMs ?? 20_000,
      maxRetries: 0,
    });
    this.modelMain = options.modelMain ?? process.env.LLM_MODEL_MAIN ?? 'gpt-4o-mini';
    this.modelCheap = options.modelCheap ?? process.env.LLM_MODEL_CHEAP ?? this.modelMain;
  }

  async structured<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
    const model = req.tier === 'cheap' ? this.modelCheap : this.modelMain;
    const messages = this.buildMessages(req);

    // Попытка 1: строгий json_schema.
    try {
      const raw = await this.call(model, messages, toJsonSchema(req.schema), 'schema');
      const parsed = req.schema.safeParse(parseJson(raw));
      if (parsed.success) {
        return this.result(parsed.data, model);
      }
      // Ответ пришёл, но не прошёл схему — один повтор с текстом ошибки.
      const retry = await this.call(
        model,
        [...messages, { role: 'user', content: `Предыдущий ответ не прошёл валидацию: ${parsed.error.message}. Верни только корректный JSON.` }],
        toJsonSchema(req.schema),
        'schema',
      );
      return this.result(req.schema.parse(parseJson(retry)), model);
    } catch (error) {
      // Провайдер мог отвергнуть json_schema — один повтор обычным JSON.
      try {
        const raw = await this.call(
          model,
          [...messages, { role: 'user', content: 'Верни только корректный JSON без пояснений.' }],
          undefined,
          'plain',
        );
        return this.result(req.schema.parse(parseJson(raw)), model);
      } catch {
        throw new Error(`Polza LLM: не удалось получить валидный ответ (${describeError(error)})`);
      }
    }
  }

  private buildMessages(req: LlmRequest<unknown>): OpenAI.Chat.ChatCompletionMessageParam[] {
    const user: OpenAI.Chat.ChatCompletionContentPart[] = [
      { type: 'text', text: JSON.stringify(req.vars) },
      ...(req.images ?? []).map(
        (image): OpenAI.Chat.ChatCompletionContentPart => ({
          type: 'image_url',
          image_url: { url: `data:${image.mimeType};base64,${image.data}` },
        }),
      ),
    ];
    return [
      { role: 'system', content: `Промпт: ${req.promptId}. Отвечай строго в формате JSON по заданной схеме.` },
      { role: 'user', content: user },
    ];
  }

  private async call(
    model: string,
    messages: OpenAI.Chat.ChatCompletionMessageParam[],
    schema: Record<string, unknown> | undefined,
    mode: 'schema' | 'plain',
  ): Promise<string> {
    const completion = await this.client.chat.completions.create({
      model,
      temperature: 0,
      messages,
      ...(mode === 'schema' && schema
        ? {
            response_format: {
              type: 'json_schema' as const,
              json_schema: { name: 'response', schema, strict: true },
            },
          }
        : {}),
    });
    return textFromCompletion(completion);
  }

  private result<T>(value: T, model: string): LlmResult<T> {
    return { value, model, promptVersion: 'polza-v1', cached: false };
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message.slice(0, 200);
  }
  return String(error);
}
