# Карта фичи: каркас проекта (005)

Статус: active
Дата: 2026-11-14
Связано: [../README.md](../README.md), [../../specs/case9-core.md](../../specs/case9-core.md), [../../plans/case9-core.md](../../plans/case9-core.md)

Поток 0: монорепо, контракты, ядро, адаптеры-заглушки, база, API, пустая веб-оболочка, тест-контракт, сквозной срез.

## Что сделано

| Слой | Файлы |
|---|---|
| Контракты | `packages/contracts/src/fields.ts`, `domain.ts`, `events.ts`, `ai.ts`, `api.ts` — `FieldValue`, `TraceEntry`, `FieldDef`, `Appeal`, `Ticket`, статусы и переходы, `AnalysisDraft`, `buildAiExtractionSchema`, события, вход/выход API |
| Ядро | `packages/core/src/pipeline.ts`, `bus.ts`, `registry.ts`, `features.ts`, `module.ts`, `router.ts`, `tickets.ts`, `core-steps.ts`, `storage.ts`, `ports.ts`, `data.ts` |
| Адаптеры | `packages/adapters/src/` — заглушки всех портов, Polza, кэш, CMDB из `data/cmdb.json` |
| База | `packages/db/src/schema.ts`, `pg-store.ts`, `migrate.ts`, `seed/`, `migrations/0001_init.sql` |
| API | `apps/api/src/server.ts`, `index.ts`, `auth.ts`, `hub.ts`, `data.ts` — `GET /api/meta`, `POST /api/session`, `POST /api/appeals`, SSE, `GET /api/tickets/:id` |
| Веб | `apps/web/src/` — оболочка Vite + React, читает `GET /api/meta` |
| Модуль-образец | `modules/_example/` — шаг `example.extract`, подписчик, маршрут, виджет |
| Тест-контракт | `packages/testkit/src/module-contract.ts` |

## Как проверить

```bash
pnpm check
npx vitest run apps/api/tests/e2e.test.ts
docker compose up --build
```

Сквозной срез: `POST /api/appeals` с текстом «Корпус Б, кабинет 312, принтер HP не печатает, мигает красный индикатор» → пайплайн на заглушке → поля в базе → `GET /api/tickets/:id` отдаёт заявку.

## Решения и отклонения

- База в юнит-тестах — `MemoryStore` (п. 10 спецификации оставлял выбор за Семёном); PostgreSQL — в Compose через `PgStore`.
- Вместо `fastify-type-provider-zod` — общий обработчик маршрута: вход и выход проверяются схемами контрактов вручную (то же поведение без лишней зависимости).
- Веб импортирует `@ugra/core/web`, а не `@ugra/core`: серверное ядро тянет `node:crypto`.
- Модуль `_example` включён по умолчанию, иначе сквозному срезу неоткуда взять поля до задачи 006.

## Что дальше

- 006: заменить правила `_example` на `modules/extraction` и `modules/priority` с адаптером Polza.
- 007: дизайн-система, чат заявителя, карточка заявки.
- 008: полные `data/`, `testset/`, сид.
