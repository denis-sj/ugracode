import { randomUUID } from 'node:crypto';
import type { KnowledgeArticle, ModuleDeps, ToolDef } from '@ugra/core';
import { defineModule, runAgent } from '@ugra/core';
import { engineerAssistant } from './assistant';
import {
  ArticleListResponse,
  ArticleResponse,
  ArticleStepsResponse,
  AskQuestionInput,
  AskResponse,
  KnowledgeSearchResponse,
  ToggleArticleStepInput,
  ToggleArticleStepResponse,
} from './schemas';
import type { KnowledgeAgentContext } from './sources';
import { kbGetArticleTool, kbSearchTool, ticketsFindSimilarTool } from './tools';

/** Инструменты модуля как реестр для `runAgent`: `ModuleDeps` реестра инструментов не содержит. */
function knowledgeTools(): Map<string, ToolDef> {
  return new Map(
    [kbSearchTool, kbGetArticleTool, ticketsFindSimilarTool].map((tool) => [tool.name, tool]),
  );
}

function httpError(message: string, statusCode: number): Error {
  return Object.assign(new Error(message), { statusCode });
}

/** Сколько статей показывать в шаблонном ответе, если модель недоступна. */
const TEMPLATE_LIMIT = 3;

/**
 * Ответ без модели: берём найденные статьи и собираем текст из решения и шагов.
 * Так вопрос базе остаётся рабочим в демо без ключа Polza — без выдуманных источников.
 */
async function templateAnswer(
  question: string,
  deps: ModuleDeps,
  knownIds: ReadonlySet<string> = new Set(),
): Promise<{ answer: string; sources: { id: string; title: string }[]; steps?: string[]; mode: 'template' } | null> {
  let articles = await deps.db.searchKnowledge({ text: question, limit: TEMPLATE_LIMIT });
  if (articles.length === 0 && knownIds.size > 0) {
    const loaded = await Promise.all([...knownIds].map((id) => deps.db.getKnowledgeArticle(id)));
    articles = loaded.filter((article): article is KnowledgeArticle => article !== null);
  }
  if (articles.length === 0) return null;

  const primary = articles[0];
  if (!primary) return null;
  const extra = articles.slice(1).map((article) => article.title);
  const answer = [
    `По статье «${primary.title}»: ${primary.solution}`,
    extra.length > 0 ? `Ещё подходят: ${extra.join(', ')}.` : '',
    'Ответ собран по базе знаний без модели — проверьте шаги статьи.',
  ]
    .filter((line) => line !== '')
    .join(' ');

  return {
    answer,
    sources: articles.map((article) => ({ id: article.id, title: article.title })),
    ...(primary.steps.length > 0 ? { steps: [...primary.steps] } : {}),
    mode: 'template',
  };
}

/**
 * База знаний на агентном харнессе: статьи и похожие заявки выбирает агент
 * инструментами (`kb_search`, `kb_get_article`, `tickets_find_similar`).
 * Эмбеддинги и pgvector не используются — поиск по словам и полнотекстовый индекс.
 */
export default defineModule({
  id: 'knowledge',
  title: 'База знаний и похожие заявки',
  enabledByDefault: true,
  tools: [kbSearchTool, kbGetArticleTool, ticketsFindSimilarTool],
  agents: [engineerAssistant],
  routes(router, deps) {
    router.get(
      '/search',
      'tickets.read',
      async ({ query }) => {
        const text = (query.q ?? '').trim();
        if (text === '') return { articles: [], tickets: [] };
        const category = query.category?.trim() || undefined;
        const [articles, tickets] = await Promise.all([
          deps.db.searchKnowledge({ text, category }),
          deps.db.findSimilarTickets({ text, category }),
        ]);
        return { articles, tickets };
      },
      { response: KnowledgeSearchResponse },
    );

    /** Каталог статей: пустой экран инженера показывает всю базу, а не «опишите проблему». */
    router.get('/articles', 'tickets.read', async () => ({ articles: await deps.db.listKnowledgeArticles() }), {
      response: ArticleListResponse,
    });

    /** Статья по id — кнопка «Открыть статью» у источника в ответе агента. */
    router.get(
      '/articles/:id',
      'tickets.read',
      async ({ params }) => {
        const id = (params.id ?? '').trim();
        if (id === '') throw httpError('Не указан id статьи', 400);
        return { article: await deps.db.getKnowledgeArticle(id) };
      },
      { response: ArticleResponse },
    );

    /** Чек-лист шагов статьи на карточке инженера: состояние хранится у заявки. */
    router.get(
      '/tickets/:ticketId/steps',
      'tickets.read',
      async ({ params }) => {
        const ticketId = (params.ticketId ?? '').trim();
        if (ticketId === '') throw httpError('Не указана заявка', 400);
        const ticket = await deps.db.getTicket(ticketId);
        if (!ticket) throw httpError(`Заявка ${ticketId} не найдена`, 404);
        return { ticketId, steps: await deps.db.listArticleSteps(ticketId) };
      },
      { response: ArticleStepsResponse },
    );

    router.post(
      '/tickets/:ticketId/steps',
      'tickets.transition',
      async ({ params, body }) => {
        const ticketId = (params.ticketId ?? '').trim();
        if (ticketId === '') throw httpError('Не указана заявка', 400);
        const input = body as { articleId: string; stepIndex: number; done: boolean };

        const ticket = await deps.db.getTicket(ticketId);
        if (!ticket) throw httpError(`Заявка ${ticketId} не найдена`, 404);
        const article = await deps.db.getKnowledgeArticle(input.articleId);
        if (!article) throw httpError(`Статья ${input.articleId} не найдена`, 404);
        if (input.stepIndex >= article.steps.length) {
          throw httpError(
            `В статье «${article.title}» ${article.steps.length} шагов, шага ${input.stepIndex + 1} нет`,
            400,
          );
        }

        const step = await deps.db.toggleArticleStep(
          ticketId,
          input.articleId,
          input.stepIndex,
          input.done,
        );
        return { step };
      },
      { body: ToggleArticleStepInput, response: ToggleArticleStepResponse },
    );

    /** Вопрос базе знаний: агент `engineer-assistant` ищет статьи инструментами и ссылается на них. */
    router.post(
      '/ask',
      'tickets.read',
      async ({ body, user }) => {
        const question = (body as { question: string }).question;
        const context: KnowledgeAgentContext = {
          user,
          ports: deps.ports,
          data: deps.data,
          db: deps.db,
          clock: deps.clock,
          knowledgeSources: new Set<string>(),
        };
        const run = await runAgent(
          engineerAssistant,
          { text: question, context },
          {
            llm: deps.ports.llm,
            tools: knowledgeTools(),
            runId: `ask-${randomUUID()}`,
            store: deps.db,
          },
        );

        if (run.status === 'ok' && run.result && run.result.sources.length > 0) {
          return { ...run.result, mode: 'agent' as const };
        }

        const fallback = await templateAnswer(question, deps, context.knowledgeSources ?? new Set());
        if (fallback) return fallback;
        throw httpError(
          run.status === 'ok'
            ? 'Модель не сослалась на статьи базы знаний — ответ не принят'
            : `Не удалось ответить по базе знаний: ${run.error ?? 'нет результата'}`,
          422,
        );
      },
      { body: AskQuestionInput, response: AskResponse },
    );
  },
  async seed() {
    // Статьи лежат в `data/kb/*.json` и загружаются сидом базы: своих таблиц у модуля нет.
  },
});
