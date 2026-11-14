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
