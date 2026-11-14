# Модуль `knowledge`

Что делает: объявляет инструменты `kb_search`, `kb_get_article`, `tickets_find_similar` — агент сам ищет статьи и похожие заявки (без эмбеддингов, по словам и полнотекстовому индексу Postgres), агента `engineer-assistant` для вопроса инженера базе знаний и маршруты экрана инженера: поиск, статья по id, чек-лист шагов у заявки, вопрос базе.
Флаг фичи: `enabledByDefault: true`; выключение — `FEATURES_OFF=knowledge` (агенты останутся без инструментов базы знаний).
Точки расширения: `tools` (поиск — в `storage.ts` ядра: `searchKnowledge`, `getKnowledgeArticle`, `findSimilarTickets`), `agents` (`engineer-assistant`), `routes` (`/search`, `/articles/:id`, `/tickets/:ticketId/steps`, `/ask`), пустой `seed` (статьи уже в `data/kb/*.json`).
Момент демо: обращение про принтер HP — агент находит статью «мигает красный индикатор» с шагами и похожие закрытые заявки; инженер отмечает шаги статьи (галочки сохраняются у заявки) и задаёт вопрос базе — ответ со ссылками на источники.

## Маршруты

| Метод и путь | Право | Что делает |
|---|---|---|
| `GET /api/m/knowledge/search?q=…&category=…` | `tickets.read` | статьи и похожие заявки по словам |
| `GET /api/m/knowledge/articles/:id` | `tickets.read` | статья целиком для кнопки «Открыть статью»; нет статьи — `article: null` |
| `GET /api/m/knowledge/tickets/:ticketId/steps` | `tickets.read` | отметки шагов статей у заявки; неизвестная заявка — 404 |
| `POST /api/m/knowledge/tickets/:ticketId/steps` | `tickets.transition` | `{ articleId, stepIndex, done }` — поставить/снять галочку; 404 — нет заявки или статьи, 400 — шага нет в статье |
| `POST /api/m/knowledge/ask` | `tickets.read` | `{ question }` — ответ агента `engineer-assistant` со ссылками; без источников — шаблон по найденным статьям или 422 |

## Шаги статьи чек-листом

- Состояние живёт у заявки: таблица `ticket_article_step (ticket_id, article_id, step_index, done, updated_at)`, миграция `packages/db/migrations/0010_article_checklist.sql`.
- Методы `KernelStore`: `listArticleSteps(ticketId)`, `toggleArticleStep(ticketId, articleId, stepIndex, done)`. Повтор с тем же `done` не меняет время: действие идемпотентно.
- `MemoryStore` — в памяти (тесты и демо без базы), `PgStore` — upsert по первичному ключу `(ticket_id, article_id, step_index)`.
- Интерфейс (`engineer-desk`): чек-лист в карточке задачи, счётчик «выполнено N из M»; в статье на вкладке «База знаний» отметки живут только в интерфейсе — заявки там нет.

## Агент `engineer-assistant` (г6)

- Профиль: `modules/knowledge/server/assistant.ts`, промпт — `modules/knowledge/prompts/engineer-assistant.v1.md`, не больше 5 шагов.
- Инструменты: `kb_search`, `kb_get_article`, `tickets_find_similar` (право `tickets.read`), итог — только `submit`.
- `submit`: `{ answer, sources: [{ id, title }], steps? }`. `check` сверяет каждую ссылку с id, которые вернули инструменты **этого** прогона (множество в контексте, `server/sources.ts`); выдуманный источник и пустой `sources` возвращаются модели как ошибка.
- Маршрут `/ask` запускает `runAgent` с инструментами модуля (в `ModuleDeps` реестра нет) и сохраняет след в `agent_step`. Модель недоступна или сослалась не на статьи — ответ-шаблон по найденным статьям (`mode: 'template'`), статей нет — 422. Так вопрос базе работает и в демо без ключа Polza.
- Источник `tickets_find_similar` в ссылки не попадает: `sources` — только статьи, которые можно открыть.

## Тесты

```bash
npx vitest run modules/knowledge
```

- инструменты на статьях из `data/kb/*.json` (файлы читаются в тесте): принтер/красный индикатор, замятие бумаги, категория и лимит, шаги статьи, неизвестный id → `null`, пустая база заявок → `[]`;
- шаги статьи: галочка, повтор без изменений, снятие, изоляция заявок и статей, пустой список;
- маршруты шагов: права `tickets.read`/`tickets.transition`, сохранение через POST, 404 на чужую заявку/статью, 400 на шаг вне статьи, валидация тела;
- агент: ответ со ссылками на `kb_search`, выдуманный источник отклонён `check`, пустой `sources` отклонён, модель недоступна → `failed`;
- маршрут `/ask`: ответ агента, шаблон без источников, 422 без статей, схема вопроса;
- веб-часть (`tests/web-format.test.ts`): строки списка, битый ответ API, фильтр по словам, ссылки-источники, пометка шаблонного ответа, прогресс шагов;
- тест-контракт модуля и сквозной прогон с выключением модуля.

## Веб-часть: экран 13 «База знаний»

- `web/index.ts` — `defineWebModule id='knowledge'`, страница `/knowledge` для ролей `engineer` и `admin`.
- `web/KnowledgePage.tsx` — поиск своими словами (`/search`), список статей с категорией, симптомами и оценкой
  релевантности, выбранная статья с симптомами, шагами-чек-листом, решением и категорией, блок «Спросить базу»
  (`/ask`) с ответом, источниками и пометкой `mode: 'template'`, кнопка черновика статьи (выключена — маршрута нет).
- Шаги статьи отмечаются локально: на экране базы знаний нет заявки, а `POST /tickets/:ticketId/steps` требует `ticketId`.
- `web/format.ts` — чистые функции `articleRows`, `filterArticles`, `sourceLinks`, `askModeLabel`, `stepsDone`,
  `articleStats`; тесты — `tests/web-format.test.ts`.
- Чего API не даёт: статистики статьи (`stats`: «помогла N из M»), маршрута сборки черновика. На экране это
  честно помечено `❓`, цифры не выдумываются.
- Регистрация — одна строка в `modules/registry.web.ts`: `import knowledgeWeb from './knowledge/web';` и
  `knowledgeWeb` в `webModules`.

## Регистрация

`modules/registry.server.ts`: `import knowledge from './knowledge/server';` и `knowledge` в `serverModules`
(в алфавитном порядке) — уже зарегистрирован, менять не нужно. Миграция `0010` применяется `pnpm migrate`.
