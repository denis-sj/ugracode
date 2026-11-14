import type { KnowledgeArticle, KnowledgeSimilarTicket, ToolDef } from '@ugra/core';
import {
  KbGetArticleInput,
  KbSearchInput,
  TicketsFindSimilarInput,
  type KbGetArticleArgs,
  type KbSearchArgs,
  type TicketsFindSimilarArgs,
} from './schemas';
import { rememberArticles } from './sources';

/**
 * Инструменты базы знаний для агента `intake` (и будущего `engineer-assistant`).
 * Поиск — по словам и полнотекстовому индексу Postgres, без эмбеддингов.
 */

export interface KbSearchResult {
  articles: KnowledgeArticle[];
}

export interface KbGetArticleResult {
  article: KnowledgeArticle | null;
}

export interface SimilarTicketsResult {
  tickets: KnowledgeSimilarTicket[];
}

export const kbSearchTool: ToolDef<KbSearchArgs, KbSearchResult> = {
  name: 'kb_search',
  description:
    'Ищет статьи базы знаний по словам из обращения: симптом, объект, код ошибки. Вызывай, когда нужно понять причину проблемы или подобрать статью для заявки. Возвращает статьи с оценкой совпадения; полные шаги — через kb_get_article.',
  input: KbSearchInput,
  capability: 'tickets.read',
  async execute(args, ctx) {
    const articles = await ctx.db.searchKnowledge({
      text: args.query,
      category: args.category,
      limit: args.limit,
    });
    rememberArticles(ctx, articles);
    return { articles };
  },
  summarize(result) {
    const first = result.articles[0];
    return first
      ? `База знаний: ${result.articles.length} статей, первая — «${first.title}»`
      : 'База знаний: ничего не найдено';
  },
};

export const kbGetArticleTool: ToolDef<KbGetArticleArgs, KbGetArticleResult> = {
  name: 'kb_get_article',
  description:
    'Возвращает статью базы знаний целиком: симптомы, шаги диагностики и решение. Вызывай по id из kb_search, когда нужно передать шаги инженеру или заявителю.',
  input: KbGetArticleInput,
  capability: 'tickets.read',
  async execute(args, ctx) {
    const article = await ctx.db.getKnowledgeArticle(args.id);
    if (article) rememberArticles(ctx, [article]);
    return { article };
  },
  summarize(result) {
    return result.article
      ? `Статья «${result.article.title}»: ${result.article.steps.length} шагов`
      : 'Статья не найдена';
  },
};

export const ticketsFindSimilarTool: ToolDef<TicketsFindSimilarArgs, SimilarTicketsResult> = {
  name: 'tickets_find_similar',
  description:
    'Ищет похожие заявки по словам, категории и корпусу. Вызывай, чтобы понять, как решали такую проблему раньше и сколько это занимало. Возвращает номера заявок, статусы и короткое описание проблемы.',
  input: TicketsFindSimilarInput,
  capability: 'tickets.read',
  async execute(args, ctx) {
    const tickets = await ctx.db.findSimilarTickets({
      text: args.text,
      category: args.category,
      building: args.building,
      limit: args.limit,
    });
    return { tickets };
  },
  summarize(result) {
    return `Похожие заявки: ${result.tickets.length}`;
  },
};
