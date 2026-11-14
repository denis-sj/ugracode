import { z } from 'zod';

/**
 * Контракты экрана «Качество ИИ» (К2).
 *
 * Схемы живут в модуле, а не в `packages/contracts`: экран — точка расширения
 * `quality`, общий контракт API от этого не меняется. Источник данных один и тот же:
 * последний `reports/quality.md` или свежий прогон контрольного набора.
 */

/** Сколько обращений показывает и гоняет экран: набор контрольный, больше не нужно. */
export const QUALITY_CASE_LIMIT = 10;

/** Потолок прогона: дольше демо ждать не должно. */
export const QUALITY_RUN_TIMEOUT_MS = 60_000;

/** Поля обращения: верно / всего / выдумано. */
export const QualityFieldScore = z.object({
  correct: z.number().int().nonnegative(),
  total: z.number().int().nonnegative(),
  invented: z.number().int().nonnegative(),
});
export type QualityFieldScore = z.infer<typeof QualityFieldScore>;

/** Авария: распознана, пропущена или ложная тревога. */
export const QualityEmergency = z.enum(['ok', 'miss', 'false']);
export type QualityEmergency = z.infer<typeof QualityEmergency>;

/** Одно обращение набора: 7 оценщиков, шаги и строки разбора ошибок. */
export const QualityCase = z.object({
  id: z.string().min(1),
  title: z.string(),
  fields: QualityFieldScore,
  priority: z.boolean().nullable(),
  emergency: QualityEmergency.nullable(),
  assigneeTop1: z.boolean().nullable(),
  assigneeTop3: z.boolean().nullable(),
  article: z.boolean().nullable(),
  question: z.boolean().nullable(),
  steps: z.number().int().nonnegative(),
  /** Готовые строки «эталон / ИИ», выдуманные поля, статья, шаг. */
  details: z.array(z.string()),
});
export type QualityCase = z.infer<typeof QualityCase>;

/** Оценщик с порогом — строка сводки. */
export const QualityMetric = z.object({
  key: z.string(),
  title: z.string(),
  value: z.number(),
  display: z.string(),
  ideal: z.string(),
  threshold: z.string(),
  passed: z.boolean(),
  /** Сколько случаев участвовало; 0 — эталона в наборе нет. */
  total: z.number().int().nonnegative(),
  note: z.string().optional(),
});
export type QualityMetric = z.infer<typeof QualityMetric>;

export const QualitySummaryView = z.object({
  cases: z.number().int().nonnegative(),
  met: z.number().int().nonnegative(),
  withThreshold: z.number().int().nonnegative(),
  failedSteps: z.number().int().nonnegative(),
  metrics: z.array(QualityMetric),
});
export type QualitySummaryView = z.infer<typeof QualitySummaryView>;

/** Ответ и чтения отчёта, и прогона: экран не различает источник. */
export const QualityReport = z.object({
  empty: z.boolean(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
  model: z.string().nullable(),
  set: z.string().nullable(),
  duration: z.string().nullable(),
  cases: z.array(QualityCase),
  summary: QualitySummaryView,
  notes: z.array(z.string()),
});
export type QualityReport = z.infer<typeof QualityReport>;

/** Прогон без параметров: набор и лимит задаёт сервер. */
export const QualityRunRequest = z.object({});
export type QualityRunRequest = z.infer<typeof QualityRunRequest>;
