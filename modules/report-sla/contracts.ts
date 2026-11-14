import { z } from 'zod';
import { PriorityLevel, TicketStatus } from '@ugra/contracts';

/** Схемы отчёта О3 «Сроки (SLA)» — общие для сервера и будущей веб-части. */

export const SlaParams = z.object({
  /** Период в днях, по умолчанию 30. */
  days: z.coerce.number().int().min(1).max(365).optional(),
  /** Только заявки этого приоритета. */
  priority: PriorityLevel.optional(),
  /** Только заявки этого исполнителя. */
  assigneeId: z.string().min(1).optional(),
});
export type SlaParams = z.infer<typeof SlaParams>;

export const SlaPeriod = z.object({
  from: z.string(),
  to: z.string(),
  days: z.number().int().positive(),
});
export type SlaPeriod = z.infer<typeof SlaPeriod>;

export const SlaSummary = z.object({
  total: z.number().int().nonnegative(),
  closed: z.number().int().nonnegative(),
  open: z.number().int().nonnegative(),
  cancelled: z.number().int().nonnegative(),
  /** Закрытые заявки, у которых известен срок решения. */
  dueKnown: z.number().int().nonnegative(),
  onTimeClosed: z.number().int().nonnegative(),
  lateClosed: z.number().int().nonnegative(),
  /** Открытые заявки, срок решения которых уже прошёл. */
  openOverdue: z.number().int().nonnegative(),
  /** Открытые заявки, срок решения наступит в ближайшие 24 часа. */
  atRisk: z.number().int().nonnegative(),
  /** Доля закрытых в срок среди закрытых с известным сроком, %. */
  slaOnTimePercent: z.number().nullable(),
  /** Заявки, где известны и срок реакции, и фактическая реакция. */
  reactionKnown: z.number().int().nonnegative(),
  /** Заявки, где фактическая реакция известна (даже без срока). */
  reactionMeasured: z.number().int().nonnegative(),
  reactionOnTime: z.number().int().nonnegative(),
  reactionBreaches: z.number().int().nonnegative(),
  reactionOnTimePercent: z.number().nullable(),
  avgReactionMinutes: z.number().nullable(),
  avgResolutionMinutes: z.number().nullable(),
  /** Средняя просрочка закрытых с нарушением срока, мин. */
  avgLateMinutes: z.number().nullable(),
});
export type SlaSummary = z.infer<typeof SlaSummary>;

export const SlaPriorityRow = z.object({
  priority: PriorityLevel.nullable(),
  label: z.string(),
  total: z.number().int().nonnegative(),
  closed: z.number().int().nonnegative(),
  lateClosed: z.number().int().nonnegative(),
  openOverdue: z.number().int().nonnegative(),
  /** Нарушения срока: закрытые с просрочкой + открытые просроченные. */
  breaches: z.number().int().nonnegative(),
  onTimePercent: z.number().nullable(),
  avgResolutionMinutes: z.number().nullable(),
  avgLateMinutes: z.number().nullable(),
});
export type SlaPriorityRow = z.infer<typeof SlaPriorityRow>;

export const SlaDepartmentRow = z.object({
  departmentId: z.string().nullable(),
  label: z.string(),
  total: z.number().int().nonnegative(),
  closed: z.number().int().nonnegative(),
  lateClosed: z.number().int().nonnegative(),
  openOverdue: z.number().int().nonnegative(),
  breaches: z.number().int().nonnegative(),
  onTimePercent: z.number().nullable(),
  avgResolutionMinutes: z.number().nullable(),
});
export type SlaDepartmentRow = z.infer<typeof SlaDepartmentRow>;

export const SlaTicketRef = z.object({
  id: z.string(),
  number: z.string(),
  priority: PriorityLevel.nullable(),
  status: TicketStatus,
  assigneeId: z.string().nullable(),
  assigneeName: z.string(),
  departmentId: z.string().nullable(),
  dueAt: z.string(),
  /** На сколько минут просрочен срок: больше нуля. */
  lateMinutes: z.number().int().positive(),
  state: z.enum(['late-closed', 'overdue-open']),
});
export type SlaTicketRef = z.infer<typeof SlaTicketRef>;

export const SlaResult = z.object({
  period: SlaPeriod,
  filters: z.object({
    priority: PriorityLevel.optional(),
    assigneeId: z.string().optional(),
  }),
  summary: SlaSummary,
  byPriority: z.array(SlaPriorityRow),
  byDepartment: z.array(SlaDepartmentRow),
  /** Топ-5 худших по SLA: просроченные закрытые и открытые с истёкшим сроком. */
  worst: z.array(SlaTicketRef),
});
export type SlaResult = z.infer<typeof SlaResult>;

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

export const SlaRun = z.object({
  report: SlaResult,
  facts: z.array(FactSchema),
  insight: ReportInsight,
});
export type SlaRun = z.infer<typeof SlaRun>;
