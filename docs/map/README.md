# Карта кода

Статус: active
Дата: 2026-11-14
Связано: [recipes.md](recipes.md), [../knowledge/environments.md](../knowledge/environments.md), [features/skeleton.md](features/skeleton.md), [../specs/case9-core.md](../specs/case9-core.md)

Монорепо на pnpm workspaces. Карту заполняет Семён по мере появления кода, **в том же PR**, что и код.

## Слои и направление зависимостей

```
apps (api, web) → modules → adapters, db → core → contracts
```

Стрелка = «может импортировать». Обратно нельзя — проверяет ESLint (`eslint.config.js`, правило `no-restricted-imports`).

| Путь | Что там | Можно импортировать |
|---|---|---|
| `packages/contracts/` | zod-схемы: домен, поля, события, ответ ИИ, API. Единственный источник типов | только `zod` |
| `packages/core/` | движок пайплайна, шина событий, реестры, порты, `defineModule`, флаги фич, сервис заявок, агентный цикл и инструменты | `contracts` |
| `packages/core/src/web.ts` | браузерная точка входа: `defineWebModule` и типы экранов (без `node:crypto`) | `contracts` |
| `packages/adapters/` | реализации портов: заглушки, Polza, кэш, CMDB, уведомления, часы | `contracts`, `core` |
| `packages/db/` | таблицы Drizzle, миграция, `PgStore` (реализация `KernelStore`), сид | `contracts`, `core` |
| `packages/testkit/` | тест-контракт модулей и фабрики тестовых данных | `contracts`, `core` |
| `modules/<id>/` | фича: `server/index.ts`, `web/index.ts`, `contracts.ts`, `tests/`, `README.md` | `contracts`, `core`, `adapters`, `db` |
| `apps/api/` | Fastify: сборка ядра и модулей, HTTP, SSE, cookie-сессии | всё серверное |
| `apps/web/` | Vite + React: оболочка, слоты виджетов, веб-модули | `contracts`, `@ugra/core/web`, веб-части модулей |

`modules/registry.server.ts` и `modules/registry.web.ts` — манифесты: одна строка на модуль (модули не импортируют друг друга).

## Точки входа

| Что | Файл |
|---|---|
| Сервер | `apps/api/src/index.ts` → `buildServer()` в `apps/api/src/server.ts` |
| Сквозной срез | `POST /api/appeals` → `PipelineEngine.run()` → `TicketService.applyAnalysis()` |
| Проверка диспетчером | `apps/api/src/server.ts`: `PATCH /api/tickets/:id/fields/:key`, `POST /confirm`, `POST /transition`, `POST /reanalyze`, `GET /tickets/:id/events` |
| Уведомления и настройки | подписчик `ticket.assigned` → таблица `notification`; `GET/PUT /api/settings` |
| Пайплайн | `packages/core/src/pipeline.ts` (стадии, `order`, таймаут, `fallback`, `rerun`) |
| Шина событий | `packages/core/src/bus.ts` (запись в `event_log`, затем подписчики) |
| Реестры | `packages/core/src/registry.ts` (`buildRegistries`, `collectRoutes`, `subscribeModules`) |
| Агентный харнесс | `packages/core/src/agent.ts` (`runAgent`, `assembleSystemPrompt`) — цикл инструментов, шлюз, `submit`; карта фичи [features/agent-harness.md](features/agent-harness.md) |
| Инструменты ядра | `packages/core/src/tools.ts` (`coreTools`: `dictionary_lookup`, `cmdb_*`) |
| След агента | таблица `agent_step` (`KernelStore.saveAgentStep`/`listAgentSteps`), событие `agent.step` |
| Флаги фич | `packages/core/src/features.ts` (`FEATURES_OFF` / `FEATURES_ON`) |
| Модуль-образец | `modules/_example/` (шаг, подписчик, маршрут, виджет, тест-контракт) |
| Веб | `apps/web/src/App.tsx`, манифест `modules/registry.web.ts` |
| Таблицы и миграция | `packages/db/src/schema.ts`, `packages/db/migrations/0001_init.sql` |
| Сид | `packages/db/src/seed/index.ts` (`pnpm seed`) |
| Проверка Polza | `scripts/check-polza.ts` (`pnpm check:polza`) |
| Речь → текст | `POST /api/transcribe` → `SpeechPort` (`packages/adapters/src/speech/`) |
| Агенты и инструменты | `packages/core/src/agent.ts` (`runAgent`, `assembleSystemPrompt`), `packages/core/src/tools.ts` (`coreTools`), `agent_step` в базе |
| Модули разбора | `modules/extraction` (агент `intake` + `extraction.ground`), `modules/priority` (матрица), `modules/routing` (топ-3), `modules/knowledge` (статьи и похожие) |
| База знаний | `modules/knowledge` → `GET /api/m/knowledge/search`, инструменты агента `kb_search`/`kb_get_article`/`tickets_find_similar` |

## Команды

```bash
pnpm install          # зависимости монорепо
pnpm check            # типы + ESLint + тесты (главная проверка перед PR)
pnpm typecheck        # tsc --noEmit
pnpm lint             # ESLint, в том числе границы слоёв
pnpm test             # Vitest
pnpm migrate          # миграция базы (DATABASE_URL)
pnpm seed             # справочники, пользователи, поля; затем seed() модулей
pnpm demo:reset       # пересеять демо-данные
pnpm dev:api          # API на http://localhost:3001
pnpm dev:web          # веб на http://localhost:5173
pnpm check:polza      # проверка API Polza (нужен POLZA_API_KEY)
docker compose up --build   # db + api + web одной командой
docker compose --profile sonar up -d sonar   # SonarQube, http://localhost:9000
python3 -m unittest discover -s tests   # проверка ссылок документации
```

## Переменные окружения (только имена)

| Имя | Назначение |
|---|---|
| `DATABASE_URL` | подключение к PostgreSQL |
| `PORT` | порт API (по умолчанию 3001) |
| `SESSION_SECRET` | подпись cookie сессии |
| `AI_MODE` | `stub` / `cloud`; не задан — `cloud` при наличии ключа, иначе `stub` (кэша нет) |
| `FEATURES_OFF`, `FEATURES_ON` | выключение и включение модулей через запятую |
| `POLZA_API_KEY`, `POLZA_BASE_URL` | провайдер моделей |
| `LLM_MODEL_MAIN`, `LLM_MODEL_CHEAP` | модели разбора и дешёвых задач |
| `EMBEDDINGS_MODEL`, `EMBEDDINGS_DIM` | не используются (оставлены на будущее) |
| `SPEECH_MODEL` | распознавание речи |
| `VITE_API_URL` | адрес API для веба и прокси Vite |

Секреты только в `.env` (в `.gitignore`); в репозитории — `.env.example` с пустыми значениями.

## Тесты

| Что | Где |
|---|---|
| Контракты и переходы статусов | `packages/contracts/tests/` |
| Движок, шина, флаги, сервис заявок | `packages/core/tests/` |
| Заглушки портов, кэш, CMDB | `packages/adapters/tests/` |
| Тест-контракт модулей | `packages/testkit/tests/` |
| Сквозной срез `POST /api/appeals` → `GET /api/tickets/:id` | `apps/api/tests/e2e.test.ts` |
| Модуль-образец | `modules/_example/tests/` |

## Подводные камни

- **Веб не импортирует `@ugra/core` целиком** — там `node:crypto`. Веб-модули импортируют `@ugra/core/web`.
- **`modules/*` не являются pnpm-пакетами**: это папки с кодом, их подключают `apps/*` и манифесты реестров.
- **База в тестах — `MemoryStore`** (решение 005): быстрые тесты без Docker. PostgreSQL проверяется через Compose и `PgStore`.
- **Модуль-образец `example` включён по умолчанию** и даёт поля в сквозном тесте; предметное извлечение придёт в `modules/extraction` (задача 006).
- **`event_log` только на добавление**: триггер базы запрещает `UPDATE`/`DELETE`, поэтому `--reset` его не чистит.
