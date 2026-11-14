# Модуль `knowledge`

Что делает: объявляет инструменты `kb_search`, `kb_get_article`, `tickets_find_similar` — агент сам ищет статьи и похожие заявки (без эмбеддингов, по словам и полнотекстовому индексу Postgres) и маршрут `GET /api/m/knowledge/search?q=…&category=…` для экрана инженера.
Флаг фичи: `enabledByDefault: true`; выключение — `FEATURES_OFF=knowledge` (агент останется без инструментов базы знаний).
Точки расширения: `tools` (шаблоны поиска — в `storage.ts` ядра: `searchKnowledge`, `getKnowledgeArticle`, `findSimilarTickets`), `routes` (`/search`, право `tickets.read`), пустой `seed` (статьи уже в `data/kb/*.json`).
Момент демо: обращение про принтер HP — агент находит статью «мигает красный индикатор» с шагами и похожие закрытые заявки с номерами.
