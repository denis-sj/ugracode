import { z } from 'zod';

/** Схемы инструментов и маршрута модуля `knowledge` (задача 013). */

export const KbSearchInput = z.object({
  query: z
    .string()
    .min(1)
    .describe(
      'Слова из обращения: симптом, объект, код ошибки. Например: «принтер не печатает красный индикатор», «замятие бумаги».',
    ),
  category: z
    .string()
    .optional()
    .describe('Категория заявки из справочника: printer, network, software, server, pc.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe('Сколько статей вернуть, по умолчанию 5.'),
});
export type KbSearchArgs = z.infer<typeof KbSearchInput>;

export const KbGetArticleInput = z.object({
  id: z
    .string()
    .min(1)
    .describe('Идентификатор статьи из результата kb_search, например kb-print-red-indicator.'),
});
export type KbGetArticleArgs = z.infer<typeof KbGetArticleInput>;

export const TicketsFindSimilarInput = z.object({
  text: z
    .string()
    .optional()
    .describe('Слова о проблеме: симптомы, объект, код ошибки. Можно не указывать, если есть категория и корпус.'),
  category: z
    .string()
    .optional()
    .describe('Категория заявки из справочника: printer, network, software, server, pc.'),
  building: z.string().optional().describe('Корпус или здание: А, Б, В, ПРОМ.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe('Сколько заявок вернуть, по умолчанию 5.'),
});
export type TicketsFindSimilarArgs = z.infer<typeof TicketsFindSimilarInput>;

export const KnowledgeArticleSchema = z.object({
  id: z.string(),
  title: z.string(),
  symptoms: z.array(z.string()),
  steps: z.array(z.string()),
  solution: z.string(),
  category: z.string().nullable(),
  score: z.number().optional(),
});

export const SimilarTicketSchema = z.object({
  ticketId: z.string(),
  number: z.string(),
  status: z.string(),
  title: z.string(),
  score: z.number(),
});

/** Ответ `GET /api/m/knowledge/search?q=…&category=…` для экрана инженера. */
export const KnowledgeSearchResponse = z.object({
  articles: z.array(KnowledgeArticleSchema),
  tickets: z.array(SimilarTicketSchema),
});
export type KnowledgeSearchResult = z.infer<typeof KnowledgeSearchResponse>;

/** Статья по id: `GET /api/m/knowledge/articles/:id` (кнопка «Открыть статью»). */
export const ArticleResponse = z.object({
  article: KnowledgeArticleSchema.nullable(),
});
export type ArticleResult = z.infer<typeof ArticleResponse>;

/** Отметка шага статьи у заявки — одна галочка чек-листа. */
export const ArticleStepSchema = z.object({
  ticketId: z.string(),
  articleId: z.string(),
  stepIndex: z.number().int().min(0),
  done: z.boolean(),
  updatedAt: z.string(),
});

/** Ответ `GET /api/m/knowledge/tickets/:ticketId/steps`. */
export const ArticleStepsResponse = z.object({
  ticketId: z.string(),
  steps: z.array(ArticleStepSchema),
});
export type ArticleStepsResult = z.infer<typeof ArticleStepsResponse>;

/** Тело `POST /api/m/knowledge/tickets/:ticketId/steps`: поставить или снять галочку. */
export const ToggleArticleStepInput = z.object({
  articleId: z.string().min(1).describe('Идентификатор статьи из базы знаний.'),
  stepIndex: z.number().int().min(0).describe('Номер шага в статье, начиная с нуля.'),
  done: z.boolean().describe('true — шаг выполнен, false — галочка снята.'),
});
export type ToggleArticleStepArgs = z.infer<typeof ToggleArticleStepInput>;

export const ToggleArticleStepResponse = z.object({
  step: ArticleStepSchema,
});
export type ToggleArticleStepResult = z.infer<typeof ToggleArticleStepResponse>;

/** Ссылка на статью в ответе агента: id и заголовок из результатов инструментов. */
export const AskSourceSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
});

/** Итог агента `engineer-assistant`: ответ только по найденным статьям. */
export const EngineerAnswer = z.object({
  answer: z.string().min(1),
  sources: z.array(AskSourceSchema),
  steps: z.array(z.string()).optional(),
});
export type EngineerAnswerResult = z.infer<typeof EngineerAnswer>;

/** Тело `POST /api/m/knowledge/ask`: вопрос базе знаний. */
export const AskQuestionInput = z.object({
  question: z
    .string()
    .trim()
    .min(3)
    .max(500)
    .describe('Вопрос инженера своими словами: симптом, модель устройства, код ошибки.'),
});
export type AskQuestionArgs = z.infer<typeof AskQuestionInput>;

/** Ответ `POST /api/m/knowledge/ask`. */
export const AskResponse = z.object({
  answer: z.string(),
  sources: z.array(AskSourceSchema),
  steps: z.array(z.string()).optional(),
  /** `agent` — ответ модели, `template` — шаблон по найденным статьям без модели. */
  mode: z.enum(['agent', 'template']),
});
export type AskResult = z.infer<typeof AskResponse>;
