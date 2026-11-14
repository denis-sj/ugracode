# Карта фичи: база знаний (013)

Статус: active
Дата: 2026-11-14
Связано: [../README.md](../README.md), [../../specs/case9-agent-harness.md](../../specs/case9-agent-harness.md), [../../specs/case9-core.md](../../specs/case9-core.md#53-ключевые-алгоритмы), [../../history/2026-11.md](../../history/2026-11.md)

Серверная часть задачи 013 на агентном харнессе: **без эмбеддингов и pgvector**. Статьи и похожие
заявки выбирает агент `intake` инструментами; код проверяет, что выбранные id существуют, и считает
примерное время ремонта. Веб-виджет и страница базы знаний — отдельная работа.

## Файлы

| Файл | Что там |
|---|---|
| `packages/core/src/knowledge.ts` | типы `KnowledgeArticle`, `SimilarTicket`, запросы; слова `knowledgeWords()`, оценка `matchScore()`, `articleText()` |
| `packages/core/src/storage.ts` | методы `KernelStore`: `searchKnowledge`, `getKnowledgeArticle`, `findSimilarTickets`, `saveKnowledgeArticle`; реализация в `MemoryStore` |
| `packages/db/src/pg-store.ts` | те же методы в `PgStore`: полнотекстовый поиск Postgres + ILIKE, фильтры по категории и корпусу |
| `packages/db/src/mappers.ts` | `mapKbArticleRow()` |
| `packages/db/migrations/0004_knowledge_search.sql` | индексы: `lower(category)`, `lower(title)`, GIN `to_tsvector('russian', …)`, `lower(category)` заявки и `ticket_field(field_key, ticket_id)` |
| `modules/knowledge/server/index.ts` | `defineModule`: три инструмента, маршрут `/search`, пустой `seed` |
| `modules/knowledge/server/tools.ts` | `kb_search`, `kb_get_article`, `tickets_find_similar` (право `tickets.read`) |
| `modules/knowledge/server/schemas.ts` | zod-схемы аргументов и ответа маршрута |

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

## Инструменты и маршрут

| Что | Аргументы / путь | Право | Ответ |
|---|---|---|---|
| `kb_search` | `query`, `category?`, `limit?` | `tickets.read` | `{ articles }` с `score` |
| `kb_get_article` | `id` | `tickets.read` | `{ article }` или `{ article: null }` |
| `tickets_find_similar` | `text?`, `category?`, `building?`, `limit?` | `tickets.read` | `{ tickets }` |
| `GET /api/m/knowledge/search` | `?q=…&category=…` | `tickets.read` | `{ articles, tickets }` |

## Тесты

```bash
npx vitest run packages/core/tests/knowledge-store.test.ts modules/knowledge
```

- память: поиск по слову из симптомов, сортировка по баллу, фильтр категории, пустой запрос → `[]`,
  лимит, статья по id; похожие заявки по категории, корпусу и словам;
- инструменты на статьях из `data/kb/*.json` (файлы читаются в тесте): принтер/красный индикатор,
  замятие бумаги, категория и лимит, шаги статьи, неизвестный id → `null`, пустая база заявок → `[]`;
- тест-контракт модуля и сквозной прогон с выключением модуля.

## Регистрация

`modules/registry.server.ts`: `import knowledge from './knowledge/server';` и `knowledge` в `serverModules`
(в алфавитном порядке). Веб-часть (виджет на карточке заявки, страница «База знаний») — отдельная задача.
