# Очередь задач

Статус: active
Дата: 2026-11-14
Связано: [../history/2026-11.md](../history/2026-11.md), [../plans/README.md](../plans/README.md)

**Следующий свободный номер: 034.** Номера идут подряд и не переиспользуются.

## Как взять задачу

1. Задача подходит твоей роли, и у неё нет незакрытых блокеров.
2. В шапке задачи поставь: `Статус: in progress`, ветку, исполнителя (имя агента).
3. Если в задаче стоит «нужно ок владельца», остановись и спроси.

## Как закрыть задачу

1. Добавь запись в `docs/history/<ГГГГ-ММ>.md` по шаблону ниже.
2. Удали файл задачи **в том же PR**.

## Скиллы superpowers для Семёна

Решение владельца (2026-11-14): агент-кодер подключает нужный скилл superpowers сам, по ситуации.

| Когда | Скилл |
|---|---|
| Старт задачи (несколько агентов работают в одном репозитории) | `superpowers:using-git-worktrees` — своя рабочая копия, чтобы не мешать соседям |
| Пишешь любую функцию или чинишь баг | `superpowers:test-driven-development` |
| Упал тест, непонятное поведение | `superpowers:systematic-debugging` |
| В задаче несколько независимых кусков | `superpowers:dispatching-parallel-agents` или `superpowers:subagent-driven-development` |
| Перед словами «готово» и перед PR | `superpowers:verification-before-completion`, затем `superpowers:requesting-code-review` |
| Задача закончена, нужно оформить ветку и PR | `superpowers:finishing-a-development-branch` |

**Не запускать** `superpowers:brainstorming` и `superpowers:writing-plans` для задач из этой очереди: спецификация и
план уже есть ([../specs/case9-core.md](../specs/case9-core.md), [../plans/case9-core.md](../plans/case9-core.md)),
повторное обсуждение съест время. Вопрос по спецификации — коротко владельцу.

## Шаблон задачи (`docs/tasks/NNN-кратко.md`)

```markdown
# NNN. Название

Статус: todo | in progress | blocked | needs owner ok
Дата: ГГГГ-ММ-ДД
Роль: Данкония | Семён
Исполнитель: —
Ветка: —
PR: —
Связано: <спецификация, план>

## Что сделать
## Критерии готовности
## Блокеры
```

## Шаблон записи истории

```markdown
## NNN. Название — ГГГГ-ММ-ДД
Кто: <имя агента> · PR: #<n> · Коммиты: <SHA>
Итог: 1–2 предложения.
```

## Открытые задачи

**Код, до чекпоинта 1** (порядок и потоки — [../plans/case9-core.md](../plans/case9-core.md)):


**После брейншторма** (что и почему — [../specs/case9-features.md](../specs/case9-features.md); в задачах 006–023 в конце добавлен раздел «Изменения после брейншторма»):

 — **MUST, идёт первой и одна:** правка ядра и контрактов
- [026-screenshot.md](026-screenshot.md) — SHOULD: скриншот и фото шильдика
- [027-reports-sla-workload.md](027-reports-sla-workload.md) — SHOULD: отчёты О3 и О4
- [028-reports-kb-gaps-emergency.md](028-reports-kb-gaps-emergency.md) — COULD: отчёты О6 и О7
- [029-knowledge-extras.md](029-knowledge-extras.md) — COULD: чек-лист шагов, вопрос базе знаний
- [030-tuning-history.md](030-tuning-history.md) — COULD: история настройки

**Фронтенд по утверждённому дизайну** ([../specs/case9-ui-design.md](../specs/case9-ui-design.md)):

- [033-ui-screens-redesign.md](033-ui-screens-redesign.md) — перерисовать 14 экранов по макетам (ждёт 032)

**Код, после чекпоинта 1:**

- [009-clarify-chat.md](009-clarify-chat.md) — поток А: уточнения в чате: вопросы-карточки и повторный разбор
- [016-mass-incident.md](016-mass-incident.md) — поток А: массовость: склейка похожих обращений в инцидент
- [017-ai-vs-manual.md](017-ai-vs-manual.md) — поток Б: замер «с ИИ / без ИИ»
- [018-engineer-desk.md](018-engineer-desk.md) — поток Б: рабочее место инженера и замыкание цикла
- [019-voice-call.md](019-voice-call.md) — поток А: звонок: голос → текст → тот же пайплайн
- [020-feedback-sentiment.md](020-feedback-sentiment.md) — поток А: обратная связь заявителю и метка тональности
- [021-reports-insights.md](021-reports-insights.md) — поток Г: отчёты О2, О1, О5 с выводами
- [022-demo-hardening.md](022-demo-hardening.md) — поток В: стабильное демо: кэш, офлайн-режим, сброс, запасная копия
- [023-delivery.md](023-delivery.md) — поток Г: сдача: README, отчёт о качестве и ограничениях, план внедрения, SonarQube

**Организационные:**

- [001-choose-case.md](001-choose-case.md) — кейс 9 выбран; осталось подтвердить на платформе и записать ментора
- [002-save-regulations.md](002-save-regulations.md) — сохранить положение и критерии
- [003-download-case-files.md](003-download-case-files.md) — скачать приложенные файлы кейсов
