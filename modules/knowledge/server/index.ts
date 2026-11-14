import { defineModule } from '@ugra/core';
import { KnowledgeSearchResponse } from './schemas';
import { kbGetArticleTool, kbSearchTool, ticketsFindSimilarTool } from './tools';

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
  },
  async seed() {
    // Статьи лежат в `data/kb/*.json` и загружаются сидом базы: своих таблиц у модуля нет.
  },
});
