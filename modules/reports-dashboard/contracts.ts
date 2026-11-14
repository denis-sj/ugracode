import { z } from 'zod';

/** Схемы отчёта О0 «Дашборд» — общие для сервера и веб-части модуля. */

export const OverviewFilters = z.object({
  category: z.string().min(1).optional(),
  assigneeId: z.string().min(1).optional(),
  channel: z.enum(['chat', 'phone', 'screenshot', 'email']).optional(),
  building: z.string().min(1).optional(),
  status: z
    .enum([
      'new',
      'ai_draft',
      'waiting_applicant',
      'in_review',
      'assigned',
      'in_progress',
      'resolved',
      'closed',
      'cancelled',
    ])
    .optional(),
});

export const OverviewParams = OverviewFilters.extend({
  from: z.string().optional(),
  to: z.string().optional(),
  /** Длина периода в днях, если не заданы `from`/`to`. */
  days: z.coerce.number().int().min(1).max(365).optional(),
});
export type OverviewParams = z.infer<typeof OverviewParams>;

export const OverviewSlice = z.object({
  key: z.string(),
  label: z.string(),
  count: z.number().int().nonnegative(),
});
export type OverviewSlice = z.infer<typeof OverviewSlice>;

/**
 * Срез приоритета с разбивкой по дням периода — мини-столбцы на карточке дашборда.
 * Длина `daily` равна `period.days`, первый день — начало периода.
 */
export const OverviewPrioritySlice = OverviewSlice.extend({
  daily: z.array(z.number().int().nonnegative()),
});
export type OverviewPrioritySlice = z.infer<typeof OverviewPrioritySlice>;

/** Эффект ИИ: доля заявок периода, которые диспетчер не правил. */
export const OverviewAiEffect = z.object({
  /** Заявок, где ИИ-поля правил человек. */
  correctedTickets: z.number().int().nonnegative(),
  /** Заявок периода, по которым был разбор ИИ. */
  totalTickets: z.number().int().nonnegative(),
  /** Доля оформленных без правок, %; `null` — нечего считать. */
  withoutEditsPercent: z.number().nullable(),
});
export type OverviewAiEffect = z.infer<typeof OverviewAiEffect>;

/** Просроченная заявка для шторки «N просрочено →». */
export const OverdueItem = z.object({
  ticketId: z.string(),
  number: z.string(),
  title: z.string(),
  assigneeId: z.string().nullable(),
  assigneeName: z.string().nullable(),
  /** На сколько минут просрочен срок решения. */
  overdueMinutes: z.number().int().nonnegative(),
});
export type OverdueItem = z.infer<typeof OverdueItem>;

export const OverdueGroup = z.object({
  assigneeId: z.string().nullable(),
  assigneeName: z.string(),
  count: z.number().int().nonnegative(),
});
export type OverdueGroup = z.infer<typeof OverdueGroup>;

export const OverdueResult = z.object({
  total: z.number().int().nonnegative(),
  items: z.array(OverdueItem),
  groups: z.array(OverdueGroup),
});
export type OverdueResult = z.infer<typeof OverdueResult>;

export const OverviewTotals = z.object({
  total: z.number().int().nonnegative(),
  open: z.number().int().nonnegative(),
  closed: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
  emergency: z.number().int().nonnegative(),
  slaBreaches: z.number().int().nonnegative(),
  slaOnTimePercent: z.number().nullable(),
});
export type OverviewTotals = z.infer<typeof OverviewTotals>;

export const OverviewDeltas = z.object({
  /** Изменение числа обращений, %. */
  total: z.number().nullable(),
  open: z.number().nullable(),
  emergency: z.number().nullable(),
  /** Изменение доли «в срок», процентные пункты. */
  slaOnTime: z.number().nullable(),
  /** Изменение среднего времени решения, минуты (меньше — лучше). */
  avgResolutionMinutes: z.number().nullable(),
});
export type OverviewDeltas = z.infer<typeof OverviewDeltas>;

export const HeatmapCell = z.object({
  hour: z.number().int(),
  count: z.number().int().nonnegative(),
});
export type HeatmapCell = z.infer<typeof HeatmapCell>;

export const HeatmapRow = z.object({
  day: z.string(),
  cells: z.array(HeatmapCell),
});
export type HeatmapRow = z.infer<typeof HeatmapRow>;

export const Heatmap = z.object({
  days: z.array(HeatmapRow),
  hours: z.array(z.number().int()),
  max: z.number().int().nonnegative(),
});
export type Heatmap = z.infer<typeof Heatmap>;

export const HotSpot = z.object({
  building: z.string(),
  cabinet: z.string(),
  label: z.string(),
  count: z.number().int().nonnegative(),
  /** Доля от всех обращений периода, %. */
  sharePercent: z.number(),
});
export type HotSpot = z.infer<typeof HotSpot>;

export const OverviewInsights = z.object({
  summary: z.string(),
  priorities: z.string(),
  heatmap: z.string(),
  sla: z.string(),
  hotspots: z.object({
    meaning: z.string(),
    action: z.string().nullable(),
  }),
});
export type OverviewInsights = z.infer<typeof OverviewInsights>;

export const OverviewPeriod = z.object({
  from: z.string(),
  to: z.string(),
  days: z.number().int().positive(),
});
export type OverviewPeriod = z.infer<typeof OverviewPeriod>;

export const OverviewResult = z.object({
  period: OverviewPeriod,
  previousPeriod: OverviewPeriod,
  filters: OverviewFilters,
  totals: OverviewTotals,
  previousTotals: OverviewTotals,
  deltas: OverviewDeltas,
  avgResolutionMinutes: z.number().nullable(),
  previousAvgResolutionMinutes: z.number().nullable(),
  byPriority: z.array(OverviewPrioritySlice),
  /** Цель по доле заявок «в срок», % (из настроек; `null` — цель не задана). */
  slaTargetPercent: z.number().nullable(),
  aiEffect: OverviewAiEffect,
  byCategory: z.array(OverviewSlice),
  byBuilding: z.array(OverviewSlice),
  byAssignee: z.array(OverviewSlice),
  byStatus: z.array(OverviewSlice),
  heatmap: Heatmap,
  hotSpots: z.array(HotSpot),
  insights: OverviewInsights,
});
export type OverviewResult = z.infer<typeof OverviewResult>;
