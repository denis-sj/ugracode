# Карта фичи: массовость и инцидент (016)

Статус: active
Дата: 2026-11-14
Связано: [../README.md](../README.md), [../../specs/case9-core.md](../../specs/case9-core.md#53-ключевые-алгоритмы), [../../specs/case9-features.md](../../specs/case9-features.md), [../../tasks/016-mass-incident.md](../../tasks/016-mass-incident.md)

Серверная часть задачи 016: шаг разбора склеивает похожие обращения в инцидент, демо-маршрут создаёт
всплеск, маршруты отдают список и карточку инцидента. Экран «Авария и массовость» переведён на эти
маршруты (см. [emergency-ui.md](emergency-ui.md)): локальной имитации инцидента больше нет.

## Файлы

| Файл | Что там |
|---|---|
| `modules/mass-incident/contracts.ts` | zod-схемы `IncidentSchema`, `IncidentListItem` (+`ticketCount`), ответы списка, карточки и демо |
| `modules/mass-incident/server/place.ts` | чистые правила: `placeOfTicket`, `systemOf`, `classifyCandidate` — без эмбеддингов и модели |
| `modules/mass-incident/server/detect.ts` | расчёт окна и порога, поиск/создание инцидента, привязка заявок, событие и уведомления дежурным |
| `modules/mass-incident/server/index.ts` | `defineModule`: шаг `mass-incident.detect`, маршруты `/demo`, `/incidents`, `/incidents/:id`, пустой `seed` |
| `packages/core/src/storage.ts` | типы `Incident`, `IncidentFilter` и методы `saveIncident` / `getIncident` / `listIncidents` / `updateIncident` (память и `PgStore`) |
| `packages/db/migrations/0008_incidents.sql` | таблица `incident` (идемпотентно); связь `ticket.incident_id` была в `0001_init.sql` |
| `packages/db/src/{schema,mappers,pg-store}.ts` | `incidentTable`, `mapIncidentRow`, SQL-реализация методов инцидентов |
| `modules/mass-incident/tests/` | `mass-incident.test.ts` (шаг, порог, окно, повтор, демо, маршруты), `contract.test.ts` (тест-контракт) |

## Как считаем

Окно и порог — настройки `massWindowMinutes` (15) и `massThreshold` (5) из `data/settings.json`
(`ctx.data.settings`, при отсутствии — значения по умолчанию). Кандидаты — `listTickets({ limit: 200 })`,
только активные заявки (не `closed`/`cancelled`) с `createdAt` внутри окна. Поля места и категории читаются
из `ticket_field` (`building`, `cabinet`, `category`, `object`), категория — с запасным вариантом из колонки
`ticket.category`. Заявка текущего обращения не сравнивается сама с собой, но входит в счётчик.

| Признак | Условие | Вклад |
|---|---|---|
| `same-category` | та же категория и тот же корпус | похожее |
| `same-system` | одна система в том же корпусе: принтер и МФУ — «оргтехника» | похожее |
| `mixed-place` | разные категории в одном месте (корпус + кабинет, если известен) | сигнал «вероятно, сеть или сервер» |

Система определяется по объекту («принтер/МФУ» → оргтехника, «сеть/свитч» → сеть, «1С/почта» → ПО,
«сервер» → серверы, «компьютер/ПК» → рабочие места), иначе по категории. Счётчик — похожие + сигналы +
текущее обращение; меньше порога — шаг возвращает `{}`.

При пороге ищется открытый инцидент с тем же корпусом и категорией/системой. Нет — создаётся новый:
номер `И-YYYYMMDD-NNNN` (счётчик по инцидентам дня), `priority: emergency`, `openedAt` из `ClockPort`.
Заявки получают `incidentId` через `updateTicket`, `size` пересчитывается. Событие `mass-incident.opened`
(номер, размер, категория, корпус) и уведомление дежурным (`onShift: true` из `data/engineers.json`) уходят
только при создании; ошибки журнала и доставки шаг не валят. Если `draft.incident` уже есть — второй
инцидент не создаётся. `evaluate()` не нужен: эталона массовости в тестовом наборе нет.

## Точки входа

| Что | Где |
|---|---|
| Шаг `mass-incident.detect` (стадия `assess`, `order 150`, `reads: fields, incident`, `writes: incident`) | `modules/mass-incident/server/index.ts` |
| `POST /api/m/mass-incident/demo` (право `admin`) — 6 заявок «принтер, корпус Б, каб. 312», сразу склейка | там же: `seedDemo` → `openMassIncident` |
| `GET /api/m/mass-incident/incidents` (право `tickets.read`) — список с `ticketCount` | там же |
| `GET /api/m/mass-incident/incidents/:id` (право `tickets.read`) — инцидент и его заявки по времени | там же |
| Таблица `incident` | `packages/db/migrations/0008_incidents.sql`, `packages/db/src/schema.ts` |

## Веб-интеграция

Экран `/incidents` (`modules/emergency/web`) больше не имитирует инцидент:

- блок «Похоже на массовый сбой» грузит список `GET /api/m/mass-incident/incidents` и карточку
  `GET /api/m/mass-incident/incidents/:id`; активный инцидент — выбранный вручную или `ticket.incidentId`;
- счётчик и столбики считаются по заявкам инцидента (`readIncidentDetail`), если карточки нет —
  по `GET /api/tickets?limit=200` с фильтром категория + корпус + окно;
- кнопка «Объявить массовым инцидентом» шлёт `POST /api/m/mass-incident/demo` только администратору;
  остальным — `disabled` и подсказка «Демо-всплеск доступен администратору» (`massDeclareRights`);
- после демо показываются номер, число заявок, статус и тост; конфетти нет осознанно;
- честные состояния: «Массовых сбоев нет» и ошибка списка, без пометки «локальная имитация».

Проверено на живом API: демо создало 6 обращений, инцидент `И-YYYYMMDD-NNNN` отдал `ticketCount = 8`
(склеились 2 уже существующих похожих) и 8 заявок в карточке. Браузерная визуальная проверка осталась —
в сессии не было подключённого desktop-браузера.

## Тесты

```bash
npx vitest run modules/mass-incident
```

- пустая база → `{}`; 5 похожих за 10 минут → инцидент, `incidentId` у заявок, событие и уведомление дежурному;
- 4 похожих → инцидента нет; 5 старых (вне окна 15 минут) → нет; разные системы в одном месте — сигнал, но
  ниже порога инцидента нет (плюс чистая проверка `classifyCandidate`);
- повторный шаг находит открытый инцидент и не создаёт второй; при готовом `draft.incident` шаг молчит;
- демо-маршрут создаёт 6 заявок и склеивает их; список отдаёт `ticketCount = 6`; карточка отдаёт заявки по
  времени и падает понятной ошибкой на неизвестном id;
- `assertModuleContract` + `runModuleContract` с фиктивным писателем `fields` (как в `routing`).

## Регистрация

`modules/registry.server.ts`: `import massIncident from './mass-incident/server';` и `massIncident` в
`serverModules` (в алфавитном порядке). Файл реестра правит оркестратор: в задаче 016 он вне зоны.
