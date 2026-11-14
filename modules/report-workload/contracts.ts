import { z } from 'zod';

/** Схемы отчёта О4 «Нагрузка инженеров» — общие для сервера и будущей веб-части. */

export const WorkloadParams = z.object({
  /** Период в днях для потока закрытых заявок, по умолчанию 30. */
  days: z.coerce.number().int().min(1).max(365).optional(),
  /** Только подразделение: оно же фильтр по заявкам. */
  departmentId: z.string().min(1).optional(),
});
export type WorkloadParams = z.infer<typeof WorkloadParams>;

export const WorkloadPeriod = z.object({
  from: z.string(),
  to: z.string(),
  days: z.number().int().positive(),
});
export type WorkloadPeriod = z.infer<typeof WorkloadPeriod>;

export const WorkloadEngineerRow = z.object({
  assigneeId: z.string().nullable(),
  name: z.string(),
  departmentId: z.string().nullable(),
  departmentLabel: z.string(),
  /** Открытые заявки сейчас: текущая нагрузка, без привязки к дате создания. */
  open: z.number().int().nonnegative(),
  /** Закрытые за период. */
  closed: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  avgResolutionMinutes: z.number().nullable(),
  /** Открытых больше порога `overloadThreshold`. */
  overload: z.boolean(),
});
export type WorkloadEngineerRow = z.infer<typeof WorkloadEngineerRow>;

export const WorkloadDepartmentRow = z.object({
  departmentId: z.string().nullable(),
  label: z.string(),
  engineers: z.number().int().nonnegative(),
  open: z.number().int().nonnegative(),
  closed: z.number().int().nonnegative(),
  /** Доля открытых заявок подразделения от всех открытых, %. */
  openSharePercent: z.number(),
  avgOpenPerEngineer: z.number(),
  overloadedEngineers: z.number().int().nonnegative(),
});
export type WorkloadDepartmentRow = z.infer<typeof WorkloadDepartmentRow>;

export const WorkloadSummary = z.object({
  totalOpen: z.number().int().nonnegative(),
  totalClosed: z.number().int().nonnegative(),
  engineers: z.number().int().nonnegative(),
  overloaded: z.number().int().nonnegative(),
  avgOpenPerEngineer: z.number(),
  avgResolutionMinutes: z.number().nullable(),
  /** Порог перегруза: открытых больше этого числа. */
  overloadThreshold: z.number().int().positive(),
});
export type WorkloadSummary = z.infer<typeof WorkloadSummary>;

export const WorkloadResult = z.object({
  period: WorkloadPeriod,
  filters: z.object({ departmentId: z.string().optional() }),
  summary: WorkloadSummary,
  byEngineer: z.array(WorkloadEngineerRow),
  byDepartment: z.array(WorkloadDepartmentRow),
});
export type WorkloadResult = z.infer<typeof WorkloadResult>;

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

export const WorkloadRun = z.object({
  report: WorkloadResult,
  facts: z.array(FactSchema),
  insight: ReportInsight,
});
export type WorkloadRun = z.infer<typeof WorkloadRun>;
