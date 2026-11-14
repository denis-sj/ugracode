import { z } from 'zod';

/** Схемы отчёта О5 «Эффект ИИ» — общие для сервера и будущей веб-части. */

export const AiEffectParams = z.object({
  /** Период в днях, по умолчанию 30. */
  days: z.coerce.number().int().min(1).max(365).optional(),
});
export type AiEffectParams = z.infer<typeof AiEffectParams>;

export const AiEffectPeriod = z.object({
  from: z.string(),
  to: z.string(),
  days: z.number().int().positive(),
});
export type AiEffectPeriod = z.infer<typeof AiEffectPeriod>;

export const AiEffectFieldRow = z.object({
  fieldKey: z.string(),
  label: z.string(),
  corrections: z.number().int().nonnegative(),
  suggestions: z.number().int().nonnegative(),
});
export type AiEffectFieldRow = z.infer<typeof AiEffectFieldRow>;

export const AiEffectTotals = z.object({
  /** Заявки, где ИИ предложил хотя бы одно поле за период. */
  ticketsWithAi: z.number().int().nonnegative(),
  fieldsSuggested: z.number().int().nonnegative(),
  fieldsCorrected: z.number().int().nonnegative(),
  /** Заявки без единой правки человеком среди заявок с подсказками ИИ. */
  ticketsWithoutEdits: z.number().int().nonnegative(),
  shareWithoutEditsPercent: z.number().nullable(),
  avgCorrectionsPerTicket: z.number().nullable(),
  /** Среднее время от подсказки ИИ до подтверждения диспетчером, минуты. */
  avgMinutesToConfirm: z.number().nullable(),
  /** Подтверждённых заявок с измеримым временем до подтверждения. */
  confirmedTickets: z.number().int().nonnegative(),
  correctionsByField: z.array(AiEffectFieldRow),
});
export type AiEffectTotals = z.infer<typeof AiEffectTotals>;

export const AiEffectMeasurement = z.object({
  tickets: z.number().int().nonnegative(),
  avgMinutesToConfirm: z.number().nullable(),
});
export type AiEffectMeasurement = z.infer<typeof AiEffectMeasurement>;

export const AiEffectComparison = z.object({
  withAi: AiEffectMeasurement,
  /** `null` — замеров ручного режима нет; цифру не выдумываем. */
  withoutAi: AiEffectMeasurement.nullable(),
  source: z.enum(['measurements', 'none']),
  note: z.string(),
});
export type AiEffectComparison = z.infer<typeof AiEffectComparison>;

export const AiEffectResult = z.object({
  period: AiEffectPeriod,
  totals: AiEffectTotals,
  comparison: AiEffectComparison,
});
export type AiEffectResult = z.infer<typeof AiEffectResult>;

export const FactSchema = z.object({
  label: z.string(),
  value: z.union([z.string(), z.number()]),
});

export const InsightOutput = z.object({
  insight: z.string().min(1).max(1200),
  actions: z.array(z.string().min(1).max(300)).min(1).max(4),
});
export type InsightOutput = z.infer<typeof InsightOutput>;

export const ReportInsight = z.object({
  meaning: z.string(),
  actions: z.array(z.string()),
  source: z.enum(['ai', 'template']),
  model: z.string().nullable(),
});
export type ReportInsight = z.infer<typeof ReportInsight>;

export const AiEffectRun = z.object({
  report: AiEffectResult,
  facts: z.array(FactSchema),
  insight: ReportInsight,
});
export type AiEffectRun = z.infer<typeof AiEffectRun>;
