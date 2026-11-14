import { z } from 'zod';

/**
 * Схемы модуля `extraction`: результат агента `intake` и его данные в `draft.ext.extraction`.
 * Ключи полей проверяются кодом по реестру `ctx.data.fields` (реестр грузится из `data/fields.json`),
 * поэтому здесь `z.string()`, а не enum: реестр не доступен на этапе объявления модуля.
 */

export const IntakeField = z.object({
  key: z.string().min(1),
  value: z.string().nullable(),
  quote: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});
export type IntakeField = z.infer<typeof IntakeField>;

export const IntakeEmergency = z.object({
  suspected: z.boolean(),
  signs: z.array(z.object({ sign: z.string().min(1), quote: z.string().min(1) })),
  confidence: z.number().min(0).max(1),
});
export type IntakeEmergency = z.infer<typeof IntakeEmergency>;

export const IntakeClarify = z.object({
  fieldKey: z.string().min(1),
  question: z.string().min(1).max(160),
  options: z.array(z.string().min(1)).max(5),
});
export type IntakeClarify = z.infer<typeof IntakeClarify>;

/** Итог агента `intake` — то, что агент сдаёт через `submit`. */
export const IntakeResult = z.object({
  fields: z.array(IntakeField),
  emergency: IntakeEmergency,
  clarify: IntakeClarify.nullable(),
  summary: z.string().max(300),
  /** Статьи базы знаний, которые агент выбрал инструментом `kb_search`. */
  articles: z.array(z.object({ id: z.string().min(1), title: z.string().optional() })).max(5).optional(),
});
export type IntakeResult = z.infer<typeof IntakeResult>;

/** Критичность оборудования из CMDB — нужна модулю `priority` для поправки приоритета. */
export const EquipmentCriticality = z.enum(['low', 'medium', 'high', 'critical']);
export type EquipmentCriticality = z.infer<typeof EquipmentCriticality>;

/**
 * Данные модуля в черновике: `draft.ext.extraction`.
 * Читать их можно другим модулям (раздел 3.2 спецификации ядра), импортировать код — нельзя.
 */
export const ExtractionExtras = z.object({
  summary: z.string().optional(),
  clarify: IntakeClarify.nullable().optional(),
  emergency: IntakeEmergency.optional(),
  cmdb: z
    .object({
      equipmentId: z.string().nullable(),
      locationId: z.string().nullable(),
      criticality: EquipmentCriticality.optional(),
    })
    .optional(),
});
export type ExtractionExtras = z.infer<typeof ExtractionExtras>;

export function readExtractionExtras(ext: Record<string, unknown> | undefined): ExtractionExtras | null {
  const parsed = ExtractionExtras.safeParse(ext?.extraction);
  return parsed.success ? parsed.data : null;
}
