# Рецепты

Статус: draft
Дата: 2026-11-14
Связано: [README.md](README.md)

Пошаговые инструкции для частых изменений, каждая со ссылкой на реальный файл-образец.

## Добавить документ в docs/

1. Создать файл с блоком-заголовком (Статус, Дата, Связано).
2. Если файл лежит в `docs/rules/`, `docs/map/`, `docs/knowledge/` или `docs/hackathon/`, добавить его в дерево в `AGENTS.md`.
3. Запустить `python3 -m unittest discover -s tests`.

Образец: `docs/hackathon/criteria.md`.

## Остальные рецепты

❓ Добавить после появления кода: эндпоинт API, экран фронтенда, миграцию БД, шаг ИИ-пайплайна, тестовое обращение в наборе.

## Как добавить шаг агента (инструменты и агент)

1. Инструмент (если нужны новые данные): `ToolDef` в `server/tools.ts` модуля — `name`, русское `description` («когда вызывать»), `input`-схема zod, `capability`, `execute(args, ctx)`, `summarize`.
2. Агент: `AgentProfile` в модуле — `promptId` на файл `prompts/<имя>.vN.md`, `tools: [...]`, `submit`-схема, `check(result, ctx)`.
3. Шаг: `PipelineStep` в `server/index.ts`, `run` вызывает `runAgent(profile, input, { llm: ctx.ports.llm, tools: registries.tools, store: ctx.db, ... })`.
4. Зарегистрируй модуль в `modules/registry.server.ts` — инструменты и агенты попадут в реестры сами.
5. Тест: сценарная заглушка `StubLlm` (`ScenarioTurn`: вызов инструмента → `submit`), проверка блокировки по праву и ошибок `check`.
6. Образцы: `modules/_example` (минимальный), `modules/extraction` (агент с CMDB и проверками), `modules/knowledge` (инструменты поиска).

Проверка: `npx vitest run modules/<id>`, тест-контракт `assertModuleContract` должен проходить.
