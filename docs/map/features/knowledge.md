# Карта фичи: база знаний (013, 029)

Статус: active
Дата: 2026-11-14
Связано: [../README.md](../README.md), [../../specs/case9-agent-harness.md](../../specs/case9-agent-harness.md), [../../specs/case9-core.md](../../specs/case9-core.md#53-ключевые-алгоритмы), [../../history/2026-11.md](../../history/2026-11.md), [engineer-desk.md](engineer-desk.md)

Серверная часть задач 013 и 029 на агентном харнессе: **без эмбеддингов и pgvector**. Статьи и похожие
заявки выбирает агент `intake` инструментами; инженер спрашивает базу знаний у агента `engineer-assistant`;
код проверяет, что выбранные id существуют, и считает примерное время ремонта. Шаги статьи отмечаются
чек-листом, состояние хранится у заявки.

## Файлы

| Файл | Что там |
|---|---|
| `packages/core/src/knowledge.ts` | типы `KnowledgeArticle`, `SimilarTicket`, запросы; слова `knowledgeWords()`, оценка `matchScore()`, `articleText()` |
| `packages/core/src/storage.ts` | методы `KernelStore`: `searchKnowledge`, `getKnowledgeArticle`, `findSimilarTickets`, `saveKnowledgeArticle`, `listArticleSteps`, `toggleArticleStep`; тип `ArticleStepState`; реализация в `MemoryStore` |
| `packages/db/src/pg-store.ts` | те же методы в `PgStore`: полнотекстовый поиск Postgres + ILIKE, фильтры; upsert отметок шагов |
| `packages/db/src/mappers.ts` | `mapKbArticleRow()`, `mapTicketArticleStepRow()` |
| `packages/db/migrations/0004_knowledge_search.sql` | индексы: `lower(category)`, `lower(title)`, GIN `to_tsvector('russian', …)`, `lower(category)` заявки и `ticket_field(field_key, ticket_id)` |
| `packages/db/migrations/0010_article_checklist.sql` | таблица `ticket_article_step` и индекс по `ticket_id` (идемпотентно) |
| `modules/knowledge/server/index.ts` | `defineModule`: три инструмента, агент, маршруты `/search`, `/articles/:id`, `/tickets/:ticketId/steps`, `/ask`; шаблонный ответ без модели |
| `modules/knowledge/server/tools.ts` | `kb_search`, `kb_get_article`, `tickets_find_similar` (право `tickets.read`); запоминают id статей в контексте агента |
| `modules/knowledge/server/assistant.ts` | агент `engineer-assistant` и `checkEngineerAnswer`: ссылки только из результатов инструментов |
| `modules/knowledge/server/sources.ts` | `KnowledgeAgentContext.knowledgeSources`, `rememberArticles()` |
| `modules/knowledge/server/schemas.ts` | zod-схемы аргументов, маршрутов и итога агента |
| `modules/knowledge/prompts/engineer-assistant.v1.md` | промпт агента: только статьи, обязательные источники |

## Как ищет (без эмбеддингов)

- `MemoryStore` (тесты, демо без базы): запрос и текст статьи режутся на слова без регистра; служебные
  и короткие (< 3 букв) отбрасываются. Балл — сколько слов запроса нашлось в статье; слова сравниваются
  по началу («мигает» ≈ «мигают», «замятие» ≈ «замятия»). Сортировка по баллу, затем по `id`; лимит 5.
- `PgStore`: `to_tsvector('russian', title || symptoms || solution)` и `plainto_tsquery('russian', запрос)`;
  `ts_rank` — балл, поверх него небольшая надбавка за точное вхождение (ILIKE) в заголовок, симптомы, решение.
  Фильтр `category` — равенство без регистра. pgvector не нужен.
- Похожие заявки: слова ищутся в полях `symptoms` и `object`, фильтры — `ticket.category` и поле
  `building` из `ticket_field`. Заголовок = симптомы (иначе объект, иначе «Заявка № …»). Без слов и
  фильтров список пуст: «похожие» не определены.

## Инструменты, агент и маршруты

| Что | Аргументы / путь | Право | Ответ |
|---|---|---|---|
| `kb_search` | `query`, `category?`, `limit?` | `tickets.read` | `{ articles }` с `score` |
| `kb_get_article` | `id` | `tickets.read` | `{ article }` или `{ article: null }` |
| `tickets_find_similar` | `text?`, `category?`, `building?`, `limit?` | `tickets.read` | `{ tickets }` |
| `engineer-assistant` | 5 шагов, промпт `engineer-assistant.v1.md` | — | `{ answer, sources, steps? }` |
| `GET /api/m/knowledge/search` | `?q=…&category=…` | `tickets.read` | `{ articles, tickets }` |
| `GET /api/m/knowledge/articles/:id` | `:id` | `tickets.read` | `{ article }` или `{ article: null }` |
| `GET /api/m/knowledge/tickets/:ticketId/steps` | `:ticketId` | `tickets.read` | `{ ticketId, steps }`; нет заявки — 404 |
| `POST /api/m/knowledge/tickets/:ticketId/steps` | `{ articleId, stepIndex, done }` | `tickets.transition` | `{ step }`; 404 — нет заявки/статьи, 400 — шага нет |
| `POST /api/m/knowledge/ask` | `{ question }` | `tickets.read` | `{ answer, sources, steps?, mode }`; без статей — 422 |

## Проверки агента и шаблонный ответ

- `check` агента сверяет каждый `source.id` с множеством id, которые вернули `kb_search`/`kb_get_article`
  в этом прогоне. Выдуманный источник и пустой `sources` — ошибка модели; она исправляет `submit`.
- `runAgent` получает инструменты модуля (`Map` из `tools.ts`): в `ModuleDeps` реестра инструментов нет.
  След пишется в `agent_step` через `deps.db`.
- Если модель недоступна или не сослалась на статьи, маршрут собирает ответ-шаблон по найденным статьям
  (`mode: 'template'`, текст из `solution` и шагов). Статей нет совсем — 422. Демо без ключа Polza
  остаётся честным: источники реальные, ответ помечен как шаблон.

## Шаги статьи чек-листом (029)

- Таблица `ticket_article_step`: первичный ключ `(ticket_id, article_id, step_index)`, `done`, `updated_at`.
- `toggleArticleStep` идемпотентен: повтор с тем же `done` возвращает прежнюю запись, время не двигает.
- Отметки изолированы по заявке: `listArticleSteps('t-2')` не видит галочек `t-1`.
- Веб-часть — в [engineer-desk.md](engineer-desk.md): чек-лист на карточке задачи, в статье — локально.

## Тесты

```bash
npx vitest run modules/knowledge
```

- память: поиск по слову из симптомов, сортировка по баллу, фильтр категории, пустой запрос → `[]`,
  лимит, статья по id; похожие заявки по категории, корпусу и словам;
- инструменты на статьях из `data/kb/*.json` (файлы читаются в тесте);
- шаги статьи: поставить/повторить/снять, изоляция заявок и статей, пустой список;
- маршруты шагов: права, сохранение, 404/400, валидация тела схемой;
- агент: успешный ответ со ссылками, выдуманный источник отклонён, пустые источники, ошибка модели;
- маршрут `/ask`: ответ агента, шаблон, 422 без статей, схема вопроса;
- тест-контракт модуля и сквозной прогон с выключением модуля.

## Регистрация

`modules/registry.server.ts`: `import knowledge from './knowledge/server';` и `knowledge` в `serverModules`
(в алфавитном порядке) — уже зарегистрирован. Веб-часть — `modules/registry.web.ts` (`engineerDeskWeb`).
