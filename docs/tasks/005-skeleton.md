# 005. Каркас: монорепо, контракты, ядро, сквозной срез

Статус: in progress
Дата: 2026-11-14
Роль: Семён
Исполнитель: Семён (агент-кодер)
Ветка: feature/skeleton
PR: —
Связано: [../specs/case9-core.md](../specs/case9-core.md), [../plans/case9-core.md](../plans/case9-core.md), [README.md](README.md#скиллы-superpowers-для-семёна)

Поток 0. Работает один агент, остальные ждут. Делай минимально рабочее — не полируй.

## Что сделать

1. **Монорепо** по разделу 2 спецификации: pnpm workspaces, Node.js 22, TypeScript `strict`, ESLint (с правилом
   границ слоёв) + Prettier, Vitest. Команда `pnpm check` = типы + линтер + тесты.
2. **`packages/contracts`** — zod-схемы из разделов 3.1, 3.3, 3.5, 4.1, 5.1, 6: `FieldValue`, `TraceEntry`,
   `FieldDef`, `Appeal`, `Ticket`, статусы и таблица переходов, `AnalysisDraft`, `AnalysisResult`, `AiExtraction`
   (сборщик схемы из реестра полей), события ядра, вход и выход API.
3. **`packages/core`** — движок пайплайна (стадии, `order`, таймаут, `fallback`, сохранение шагов, `rerun`),
   шина событий, реестры (поля, шаги, аспекты, отчёты), интерфейсы портов, `defineModule`, флаги
   (`FEATURES_OFF` / `FEATURES_ON`).
4. **`packages/adapters`** — заглушки всех портов (`AI_MODE=stub`, ответы из файлов) и декоратор кэша.
5. **`packages/db`** — таблицы ядра из раздела 4 (Drizzle), миграция, триггер «`event_log` только на добавление»,
   команда `pnpm seed` (пока минимум: 4 пользователя по ролям, поля и справочники для примера заказчика).
6. **`apps/api`** — Fastify: сборка модулей из `modules/registry.server.ts`, проверка прав на маршрутах,
   `GET /api/meta`, `POST /api/session`, `GET /api/users`, `POST /api/appeals`, `GET /api/appeals/:id/stream` (SSE),
   `GET /api/tickets`, `GET /api/tickets/:id`.
7. **`apps/web`** — пустая оболочка Vite + React, собирает веб-модули из `modules/registry.web.ts`, показывает «работает».
8. **`modules/_example`** — образец модуля (один шаг, один подписчик, один маршрут, один виджет, тест, README).
   Он же — проверка `defineModule` и `defineWebModule`.
9. **`packages/testkit`** — тест-контракт модулей (раздел 10 спецификации).
10. **Docker Compose**: `db` (PostgreSQL 16 + pgvector), `api`, `web`. `.env.example` с пустыми значениями.
11. **Сквозной срез:** `POST /api/appeals` с текстом примера заказчика → пайплайн на заглушке → заявка с полями в базе →
    `GET /api/tickets/:id` её отдаёт. Автотест на это.
12. **Проверка Polza** — скрипт `scripts/check-polza.ts` (ключ из `.env`): адрес API, работает ли
    `response_format: json_schema`, эмбеддинги, распознавание речи. Результат записать в
    [../knowledge/environments.md](../knowledge/environments.md) (только «работает / не работает», без ключа).
    Не работает речь или эмбеддинги — сразу сообщить владельцу.
13. Обновить [../map/README.md](../map/README.md): слои, команды, переменные окружения (имена).

## Критерии готовности

- `docker compose up` поднимает всё одной командой; `pnpm check` зелёный.
- Автотест сквозного среза проходит; тест-контракт проходит для `_example`; с `FEATURES_OFF=_example` всё стартует.
- Агенты 006–008 могут начать, не трогая `packages/contracts` и `packages/core`.
- Результат проверки Polza записан.

## Блокеры

Ключ Polza в `.env` у владельца (нужен только для пункта 12; остальное не ждёт).
