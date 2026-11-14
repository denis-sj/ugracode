import { z } from 'zod';
import { PriorityLevel, TicketStatus } from '@ugra/contracts';

/** Схемы отчёта О7 «Аварии» — общие для сервера и будущей веб-части. */

export const EmergencyParams = z.object({
  /** Период в днях, по умолчанию 30. */
  days: z.coerce.number().int().min(1).max(365).optional(),
});
export type EmergencyParams = z.infer<typeof EmergencyParams>;

export const EmergencyPeriod = z.object({
  from: z.string(),
  to: z.string(),
  days: z.number().int().positive(),
});
export type EmergencyPeriod = z.infer<typeof EmergencyPeriod>;

export const EmergencySummary = z.object({
  total: z.number().int().nonnegative(),
  emergency: z.number().int().nonnegative(),
  /** Доля аварийных заявок от всех обращений периода, %. */
  sharePercent: z.number().nullable(),
  closed: z.number().int().nonnegative(),
  open: z.number().int().nonnegative(),
  /** Аварии, где известна фактическая реакция (назначение или подтверждение). */
  reactionMeasured: z.number().int().nonnegative(),
  avgReactionMinutes: z.number().nullable(),
  /** Мест и единиц техники с двумя и более авариями. */
  repeatedHotspots: z.number().int().nonnegative(),
  /** Сигналов `emergency.detected` в периоде. */
  detectedSignals: z.number().int().nonnegative(),
  /** Из них «под вопросом» — тревога, которую не подтвердили. */
  suspectedSignals: z.number().int().nonnegative(),
  /** Ложные тревоги = `suspectedSignals`; `null`, если событий в журнале нет. */
  falseAlarms: z.number().int().nullable(),
});
export type EmergencySummary = z.infer<typeof EmergencySummary>;

export const EmergencyHotspot = z.object({
  /** Стабильный ключ строки: `eq:<id>` для техники, `loc:<id>` для места. */
  key: z.string(),
  kind: z.enum(['equipment', 'location']),
  equipmentId: z.string().nullable(),
  locationId: z.string().nullable(),
  label: z.string(),
  count: z.number().int().positive(),
  /** Доля от всех аварий периода, %. */
  sharePercent: z.number(),
  lastAt: z.string(),
});
export type EmergencyHotspot = z.infer<typeof EmergencyHotspot>;

export const EmergencyTicketRef = z.object({
  id: z.string(),
  number: z.string(),
  createdAt: z.string(),
  status: TicketStatus,
  priority: PriorityLevel.nullable(),
  equipmentId: z.string().nullable(),
  locationId: z.string().nullable(),
});
export type EmergencyTicketRef = z.infer<typeof EmergencyTicketRef>;

export const EmergencyResult = z.object({
  period: EmergencyPeriod,
  filters: z.object({}),
  summary: EmergencySummary,
  hotspots: z.array(EmergencyHotspot),
  /** Последние аварии периода — для хронологии и перехода в заявку. */
  recent: z.array(EmergencyTicketRef),
});
export type EmergencyResult = z.infer<typeof EmergencyResult>;

export const FactSchema = z.object({
  label: z.string(),
  value: z.union([z.string(), z.number()]),
});

/** Ответ модели на «что это значит / что сделать». Проверяется кодом до показа. */
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

export const EmergencyRun = z.object({
  report: EmergencyResult,
  facts: z.array(FactSchema),
  insight: ReportInsight,
});
export type EmergencyRun = z.infer<typeof EmergencyRun>;
