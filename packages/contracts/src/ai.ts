import { z } from 'zod';
import type { FieldDef } from './fields';

/** Кандидат поля от модели. Значение — строка; проверки и приведение типов делает код. */
export const AiFieldCandidate = z.object({
  key: z.string(),
  value: z.string().nullable(),
  quote: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});
export type AiFieldCandidate = z.infer<typeof AiFieldCandidate>;

export const EmergencyAspect = z.object({
  suspected: z.boolean(),
  signs: z.array(z.object({ sign: z.string(), quote: z.string() })),
  confidence: z.number().min(0).max(1),
});
export type EmergencyAspect = z.infer<typeof EmergencyAspect>;

export const SummaryAspect = z.object({ text: z.string().max(300) });
export type SummaryAspect = z.infer<typeof SummaryAspect>;

/** Базовые аспекты ядра; модули добавляют свои через реестр аспектов. */
export const CORE_ASPECTS = {
  emergency: EmergencyAspect,
  summary: SummaryAspect,
} as const;

export type AspectSchema = z.ZodType;

/**
 * Собирает схему ответа модели из реестра полей и аспектов модулей.
 * Один вызов модели возвращает все поля и все аспекты (раздел 5.1 спецификации).
 */
export function buildAiExtractionSchema(
  fields: readonly FieldDef[],
  aspects: Record<string, AspectSchema> = CORE_ASPECTS,
): z.ZodObject<z.ZodRawShape> {
  const keys = [...new Set(fields.map((f) => f.key))];
  const keySchema = keys.length > 0 ? z.enum(keys as [string, ...string[]]) : z.string();
  const fieldSchema = AiFieldCandidate.extend({ key: keySchema });
  return z.object({
    fields: z.array(fieldSchema),
    aspects: z.object(aspects),
  });
}

export type AiExtraction = z.infer<ReturnType<typeof buildAiExtractionSchema>>;

/** JSON Schema для `response_format: json_schema` провайдера. */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: 'draft-7', io: 'output' }) as Record<string, unknown>;
}

/**
 * Сообщения и вызовы инструментов в формате OpenAI Chat Completions.
 * Формат выбран потому, что Polza его повторяет, а `tool_calls` — общий язык
 * для всех провайдеров, которые поддерживают инструменты.
 */

/** Вызов инструмента моделью: `arguments` — JSON-строка, как в OpenAI. */
export interface ToolCall {
  id: string;
  name: string;
  arguments: string;
}

export type LlmRole = 'system' | 'user' | 'assistant' | 'tool';

/** Одно сообщение диалога. У `tool` обязателен `toolCallId` — на какой вызов отвечаем. */
export interface LlmMessage {
  role: LlmRole;
  content: string | null;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  name?: string;
}

/** Описание инструмента для модели: имя, когда вызывать, JSON Schema аргументов. */
export interface LlmToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Запрос к модели с инструментами. `temperature: 0` и фиксированный `seed` — правило харнесса. */
export interface LlmChatRequest {
  messages: LlmMessage[];
  tools: LlmToolSpec[];
  model?: string;
  temperature?: number;
  seed?: number;
}

/** Ответ ассистента: текст и/или вызовы инструментов. */
export interface LlmAssistantMessage {
  role: 'assistant';
  content: string | null;
  toolCalls: ToolCall[];
}

export type LlmFinishReason = 'stop' | 'tool_calls' | 'length' | 'error';

export interface LlmUsage {
  tokensIn: number;
  tokensOut: number;
  costRub?: number;
}

export interface LlmChatResponse {
  message: LlmAssistantMessage;
  finishReason: LlmFinishReason;
  model: string;
  usage?: LlmUsage;
}
