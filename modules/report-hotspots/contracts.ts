import { z } from 'zod';

/** Схемы отчёта О2 «Горячие точки оборудования» — общие для сервера и будущей веб-части. */

export const HotspotsParams = z.object({
  /** Период в днях, по умолчанию 30. */
  days: z.coerce.number().int().min(1).max(365).optional(),
  /** Корпус: подпись («Б») или код места (`cab-b-312`). */
  building: z.string().min(1).optional(),
  /** Категория заявки, код справочника. */
  category: z.string().min(1).optional(),
});
export type HotspotsParams = z.infer<typeof HotspotsParams>;

export const HotspotPeriod = z.object({
  from: z.string(),
  to: z.string(),
  days: z.number().int().positive(),
});
export type HotspotPeriod = z.infer<typeof HotspotPeriod>;

export const HotspotRow = z.object({
  /** Стабильный ключ строки: `eq:<id>` для техники, `cab:<код>:<кабинет>` для места. */
  key: z.string(),
  kind: z.enum(['equipment', 'cabinet']),
  equipmentId: z.string().nullable(),
  label: z.string(),
  building: z.string(),
  cabinet: z.string().nullable(),
  category: z.string().nullable(),
  count: z.number().int().nonnegative(),
  /** Доля от всех обращений периода, %. */
  sharePercent: z.number(),
  avgResolutionMinutes: z.number().nullable(),
  previousCount: z.number().int().nonnegative(),
  /** Изменение числа обращений к прошлому периоду, %. `null` — в прошлом периоде повторов не было. */
  trendPercent: z.number().nullable(),
});
export type HotspotRow = z.infer<typeof HotspotRow>;

export const HotspotsResult = z.object({
  period: HotspotPeriod,
  previousPeriod: HotspotPeriod,
  filters: z.object({
    building: z.string().optional(),
    category: z.string().optional(),
  }),
  total: z.number().int().nonnegative(),
  previousTotal: z.number().int().nonnegative(),
  /** Изменение общего числа обращений к прошлому периоду, %. */
  trendPercent: z.number().nullable(),
  /** Заявки, попавшие в точки с двумя и более обращениями. */
  repeatedTickets: z.number().int().nonnegative(),
  rows: z.array(HotspotRow),
});
export type HotspotsResult = z.infer<typeof HotspotsResult>;

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

export const HotspotsRun = z.object({
  report: HotspotsResult,
  facts: z.array(FactSchema),
  insight: ReportInsight,
});
export type HotspotsRun = z.infer<typeof HotspotsRun>;
