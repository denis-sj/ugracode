# Карта фичи: сервер проверки диспетчером

Статус: active
Дата: 2026-11-14
Связано: [../README.md](../README.md), [../../specs/case9-core.md](../../specs/case9-core.md), [../../tasks/010-dispatcher-review.md](../../tasks/010-dispatcher-review.md)

Серверная часть задачи 010, без интерфейса и без ИИ. Интерфейс очереди и карточки — отдельная работа в `apps/web`.

## Маршруты

| Метод и путь | Право | Что делает |
|---|---|---|
| `PATCH /api/tickets/:id/fields/:key` | `tickets.edit` | правка поля; `origin: 'human'`, вариант ИИ остаётся в `aiValue`, событие `ticket.field.corrected` |
| `POST /api/tickets/:id/confirm` | `tickets.confirm` | подтверждение и назначение инженера; события `ticket.confirmed`, `ticket.assigned`, `ticket.status.changed` |
| `POST /api/tickets/:id/transition` | `tickets.transition` | смена статуса по таблице переходов и роли; запрещённый переход — 403 |
| `POST /api/tickets/:id/reanalyze` | `tickets.edit` | повторный запуск пайплайна и обновление полей |
| `GET /api/tickets/:id/events` | `tickets.events` | журнал действий по заявке (журнал append-only) |
| `GET /api/notifications` | любой вошедший | уведомления текущего пользователя |
| `POST /api/notifications/:id/read` | свой | отметить прочитанным |
| `GET /api/settings` | `settings` | настройки-пороги |
| `PUT /api/settings/:key` | `settings` | изменить настройку; руководитель — только `confidenceThreshold` |

## Как это устроено

- Смена статуса и правка полей — только через `TicketService` (`packages/core/src/tickets.ts`), он же публикует события.
- Подписчик `ticket.assigned` в `apps/api/src/server.ts` пишет уведомление в таблицу `notification` и зовёт `NotificationPort` (канал пока моковый).
- Настройки хранятся в таблице `setting` (`KernelStore.listSettings/setSetting`), событие `setting.changed`.
- Даты из PostgreSQL приводятся к ISO в `packages/db/src/mappers.ts` (`toIso`), поэтому контракты API не зависят от формата драйвера.

## Проверки

- `apps/api/tests/dispatcher.test.ts` — 15 тестов: подтверждение, права, правка поля, журнал, повторный разбор, уведомления, настройки.
- Живой прогон в Compose: назначение инженера → уведомление → правка поля (`313`, `aiValue` = `312`) → журнал → сохранение порога.

## Осталось (для 010 целиком)

Очередь и карточка заявки в интерфейсе, показ следа «ИИ → человек», подтверждение по Enter — зона `apps/web` и `modules/dispatcher-review/web`.
