import { z } from 'zod';

/** Схемы отчёта О6 «Пробелы базы знаний» — общие для сервера и будущей веб-части. */

export const KbGapsParams = z.object({
  /** Период в днях, по умолчанию 30. */
  days: z.coerce.number().int().min(1).max(365).optional(),
});
export type KbGapsParams = z.infer<typeof KbGapsParams>;

export const KbGapsPeriod = z.object({
  from: z.string(),
  to: z.string(),
  days: z.number().int().positive(),
});
export type KbGapsPeriod = z.infer<typeof KbGapsPeriod>;

export const KbGapsTheme = z.object({
  /** Стабильный ключ строки для `drilldown`. */
  key: z.string(),
  /** Короткая подпись темы для таблицы. */
  label: z.string(),
  /** Полный текст симптома — он же фильтр заявок. */
  symptom: z.string(),
  category: z.string().nullable(),
  categoryLabel: z.string(),
  /** Сколько заявок с этим симптомом остались без статьи. */
  count: z.number().int().nonnegative(),
  /** Доля от заявок без статьи, %. */
  sharePercent: z.number(),
  exampleTicketId: z.string().nullable(),
  exampleNumber: z.string().nullable(),
});
export type KbGapsTheme = z.infer<typeof KbGapsTheme>;

export const KbGapsCategoryRow = z.object({
  category: z.string().nullable(),
  label: z.string(),
  total: z.number().int().nonnegative(),
  withoutArticle: z.number().int().nonnegative(),
  /** Доля заявок категории без подходящей статьи, %. */
  sharePercent: z.number().nullable(),
  /** Самая частая тема в категории. */
  topSymptom: z.string().nullable(),
});
export type KbGapsCategoryRow = z.infer<typeof KbGapsCategoryRow>;

export const KbGapsSummary = z.object({
  total: z.number().int().nonnegative(),
  /** Заявки, по которым есть разбор в журнале (`analysis.completed`). */
  analyzed: z.number().int().nonnegative(),
  withArticle: z.number().int().nonnegative(),
  withoutArticle: z.number().int().nonnegative(),
  /** Доля заявок без подходящей статьи, %. */
  shareWithoutArticlePercent: z.number().nullable(),
  /** Сколько тем (строк) в отчёте. */
  themes: z.number().int().nonnegative(),
  /** Пропуски подтверждены подписчиком модуля (`report-kb-gaps.miss`). */
  fromJournal: z.number().int().nonnegative(),
  /** Статью искали по базе знаний, потому что разбора в журнале нет. */
  fromKnowledgeBase: z.number().int().nonnegative(),
});
export type KbGapsSummary = z.infer<typeof KbGapsSummary>;

export const KbGapsResult = z.object({
  period: KbGapsPeriod,
  filters: z.object({}),
  summary: KbGapsSummary,
  themes: z.array(KbGapsTheme),
  byCategory: z.array(KbGapsCategoryRow),
});
export type KbGapsResult = z.infer<typeof KbGapsResult>;

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

export const KbGapsRun = z.object({
  report: KbGapsResult,
  facts: z.array(FactSchema),
  insight: ReportInsight,
});
export type KbGapsRun = z.infer<typeof KbGapsRun>;
