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

export const SentimentAspect = z.object({
  label: z.enum(['neutral', 'negative', 'pressure']),
  quote: z.string().nullable(),
});
export type SentimentAspect = z.infer<typeof SentimentAspect>;

export const SummaryAspect = z.object({ text: z.string().max(300) });
export type SummaryAspect = z.infer<typeof SummaryAspect>;

/** Базовые аспекты ядра; модули добавляют свои через реестр аспектов. */
export const CORE_ASPECTS = {
  emergency: EmergencyAspect,
  sentiment: SentimentAspect,
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
