# Карта фичи: правка контрактов после брейншторна (024)

Статус: active
Дата: 2026-11-14
Связано: [../README.md](../README.md), [../../specs/case9-features.md](../../specs/case9-features.md), [../../specs/case9-agent-harness.md](../../specs/case9-agent-harness.md), [../../history/2026-11.md](../../history/2026-11.md)

Добавляющие изменения контрактов, ядра, API, адаптеров и базы. Существующее не переименовано, чтобы не ломать задачи 006–008.

## Что добавилось

| Где | Что |
|---|---|
| `packages/contracts/src/fields.ts` | `FieldOrigin` + `profile`; следы `from_profile`, `no_answer` |
| `packages/contracts/src/domain.ts` | `PriorityLevel` + `emergency` (5 уровней); `Ticket` + `reactDueAt`, `equipmentId`, `locationId`; `PriorityVerdict` + `reactDueAt`; `MissingField` + `source`, `allowUnknown`, `allowFreeText`, `options[].validated`; `SourceFragment.kind` + `answer`; `AnalysisDraft` + `estimate`; `AppealMessage` и `ChatCard`; переходы `assigned → in_review`, `in_progress → in_review` |
| `packages/contracts/src/ai.ts` | из `CORE_ASPECTS` убран `sentiment` |
| `packages/contracts/src/events.ts` | `ticket.deadline.extended`, `ticket.returned` |
| `packages/contracts/src/api.ts` | `aiMode: 'stub' \\| 'cloud'`; `POST /api/transcribe` (`TranscribeInput`/`TranscribeResponse`) |
| `packages/core/src/tickets.ts` | `extendDeadline()`, причина в `transition()`, запись `equipmentId`/`locationId` из полей разбора |
| `apps/api` | `POST /api/transcribe` — звук (base64) → текст через `SpeechPort`; лимит тела 25 МБ |
| `packages/adapters` | режим `cache-only`, декоратор кэша и его тесты удалены |
| `packages/db` | миграция `0002_core_contract.sql` (новые колонки, `DROP TABLE ai_cache`), мигратор применяет все SQL-файлы по порядку; сид больше не перезаписывает изменённые настройки |

## Проверки

- `apps/api/tests/core-contract.test.ts` — распознавание речи (успех, аноним, пустой звук, сбой порта), возврат заявки инженером с `ticket.returned`.
- `packages/core/tests/tickets.test.ts` — продление срока с причиной, запрет продления несуществующей заявки.
- `packages/contracts/tests/contracts.test.ts` — пять уровней приоритета, новые переходы.
- `packages/db/tests/mappers.test.ts` — новые колонки и формат дат PostgreSQL.

## Что дальше

- 031: `runAgent`, инструменты и `agent_step` — на этой базе.
- 006–008 подтягивают ветку после слияния.
