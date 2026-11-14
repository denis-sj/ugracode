import { z } from 'zod';
import { PriorityLevel, TicketStatus } from '@ugra/contracts';

/** Схемы отчёта О1 «Сводка смены» — общие для сервера и будущей веб-части. */

export const ShiftParams = z.object({
  /** День смены в формате `2026-11-14`; по умолчанию — сегодня по часам ядра. */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Дата смены: ГГГГ-ММ-ДД')
    .optional(),
});
export type ShiftParams = z.infer<typeof ShiftParams>;

export const ShiftPeriod = z.object({
  date: z.string(),
  from: z.string(),
  to: z.string(),
});
export type ShiftPeriod = z.infer<typeof ShiftPeriod>;

export const ShiftTotals = z.object({
  total: z.number().int().nonnegative(),
  /** Поступило за смену (создано в этот день). */
  created: z.number().int().nonnegative(),
  /** Закрыто или решено за смену. */
  closed: z.number().int().nonnegative(),
  emergency: z.number().int().nonnegative(),
  slaBreaches: z.number().int().nonnegative(),
  /** Доля закрытых за смену без нарушения срока, %. */
  slaOnTimePercent: z.number().nullable(),
});
export type ShiftTotals = z.infer<typeof ShiftTotals>;

export const ShiftAssigneeRow = z.object({
  assigneeId: z.string().nullable(),
  name: z.string(),
  total: z.number().int().nonnegative(),
  open: z.number().int().nonnegative(),
  closed: z.number().int().nonnegative(),
  avgResolutionMinutes: z.number().nullable(),
});
export type ShiftAssigneeRow = z.infer<typeof ShiftAssigneeRow>;

export const ShiftTicketRef = z.object({
  id: z.string(),
  number: z.string(),
  status: TicketStatus,
  priority: PriorityLevel.nullable(),
  category: z.string().nullable(),
  assigneeId: z.string().nullable(),
  createdAt: z.string(),
  slaDueAt: z.string().nullable(),
});
export type ShiftTicketRef = z.infer<typeof ShiftTicketRef>;

export const ShiftAttention = z.object({
  overdue: z.array(ShiftTicketRef),
  overdueCount: z.number().int().nonnegative(),
  waitingReview: z.array(ShiftTicketRef),
  waitingReviewCount: z.number().int().nonnegative(),
});
export type ShiftAttention = z.infer<typeof ShiftAttention>;

export const ShiftResult = z.object({
  period: ShiftPeriod,
  totals: ShiftTotals,
  byAssignee: z.array(ShiftAssigneeRow),
  attention: ShiftAttention,
});
export type ShiftResult = z.infer<typeof ShiftResult>;

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

export const ShiftRun = z.object({
  report: ShiftResult,
  facts: z.array(FactSchema),
  insight: ReportInsight,
});
export type ShiftRun = z.infer<typeof ShiftRun>;
