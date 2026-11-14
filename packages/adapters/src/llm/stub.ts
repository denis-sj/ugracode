import type { LlmChatRequest, LlmChatResponse, ToolCall } from '@ugra/contracts';
import type { LlmPort, LlmRequest, LlmResult } from '@ugra/core';

/** Один вызов инструмента в сценарии: аргументы — объект, в JSON их превратит заглушка. */
export interface ScenarioToolCall {
  name: string;
  arguments: Record<string, unknown>;
}

/**
 * Ход сценария: либо вызовы инструментов, либо сдача результата (`submit`),
 * либо просто текст. Ходы отдаются по одному на каждый `chat()`.
 */
export interface ScenarioTurn {
  toolCalls?: ScenarioToolCall[];
  submit?: unknown;
  content?: string;
}

export interface StubLlmOptions {
  /** Ответ для `structured`, если по promptId ничего нет. */
  fallback?: unknown;
  /** Сценарий для `chat`: заранее записанная последовательность вызовов. */
  scenario?: ScenarioTurn[];
}

function isOptions(value: unknown): value is StubLlmOptions {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  return keys.includes('scenario') || keys.includes('fallback');
}

/**
 * Заглушка LLM для локальной разработки и тестов.
 *
 * - `structured`: ответы задаются картой promptId → значение; иначе fallback,
 *   иначе — минимальный валидный ответ (пустые поля/аспекты).
 * - `chat`: сценарная заглушка — заранее записанная последовательность шагов агента.
 *   Второй аргумент конструктора — либо старый fallback, либо `{ fallback, scenario }`.
 */
export class StubLlm implements LlmPort {
  private readonly responses: Record<string, unknown>;
  private readonly fallback: unknown;
  private readonly scenario: ScenarioTurn[];
  private turn = 0;

  constructor(responses: Record<string, unknown> = {}, optionsOrFallback: unknown = undefined) {
    this.responses = responses;
    if (isOptions(optionsOrFallback)) {
      this.fallback = optionsOrFallback.fallback;
      this.scenario = optionsOrFallback.scenario ?? [];
    } else {
      this.fallback = optionsOrFallback;
      this.scenario = [];
    }
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

  async chat(_req: LlmChatRequest): Promise<LlmChatResponse> {
    const turn = this.scenario[this.turn];
    this.turn += 1;

    if (!turn) {
      return {
        message: { role: 'assistant', content: 'сценарий исчерпан', toolCalls: [] },
        finishReason: 'stop',
        model: 'stub',
      };
    }

    const toolCalls: ToolCall[] = (turn.toolCalls ?? []).map((call, index) => ({
      id: `call_${this.turn}_${index}`,
      name: call.name,
      arguments: JSON.stringify(call.arguments),
    }));
    if (turn.submit !== undefined) {
      toolCalls.push({
        id: `call_${this.turn}_submit`,
        name: 'submit',
        arguments: JSON.stringify(turn.submit),
      });
    }

    if (toolCalls.length > 0) {
      return {
        message: { role: 'assistant', content: turn.content ?? null, toolCalls },
        finishReason: 'tool_calls',
        model: 'stub',
      };
    }

    return {
      message: { role: 'assistant', content: turn.content ?? '', toolCalls: [] },
      finishReason: 'stop',
      model: 'stub',
    };
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
