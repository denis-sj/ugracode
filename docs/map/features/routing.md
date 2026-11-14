# Карта фичи: подбор исполнителя (012)

Статус: active
Дата: 2026-11-14
Связано: [../README.md](../README.md), [../../specs/case9-core.md](../../specs/case9-core.md#53-ключевые-алгоритмы), [../../specs/case9-features.md](../../specs/case9-features.md), [../../history/2026-11.md](../../history/2026-11.md)

Серверная часть задачи 012: топ-3 исполнителя с объяснением. Виджет на карточке заявки и страница
«Специалисты» — отдельная работа в `modules/routing/web` и `apps/web`.

## Файлы

| Файл | Что там |
|---|---|
| `modules/routing/contracts.ts` | zod-схемы `EngineerProfile`, `EngineerSkill`, `EngineersFile` (`data/engineers.json`), `CandidatesResponse` |
| `modules/routing/server/scoring.ts` | чистая функция `scoreCandidates()`: веса факторов, карта «категория → подразделение», объяснение и порог уверенности |
| `modules/routing/server/engineers.ts` | чтение `data.extra.engineers` (массив или `{ engineers }`) и демо-набор из 5 инженеров |
| `modules/routing/server/index.ts` | `defineModule`: шаг `routing.recommend`, маршрут кандидатов, `evaluate`, пустой `seed` |
| `modules/routing/tests/` | `routing.test.ts` (оценка, шаг, маршрут), `contract.test.ts` (тест-контракт) |

## Как считаем

Балл инженера — сумма факторов (`WEIGHTS` в `scoring.ts`):

| Фактор | Вес |
|---|---|
| подразделение совпало с подразделением по категории (`printer`/`pc` → `dep-it`, `network` → `dep-network`, `software` → `dep-software`, `server` → `dep-server`, иначе `dep-service`) | +40 |
| навык совпал с текстом, категорией или оборудованием | +`level` × 10 (уровень 1..5) |
| на смене | +20 |
| корпус из поля `building` есть в закреплении инженера | +15 |
| загрузка | −2 × `openTickets` |
| решал похожие | +2 × min(`resolvedSimilar`, 10) |

- Порядок: балл по убыванию, при равенстве — по `id`; берём три первых. Инженеров нет — `assignees: []`.
- Объяснение собирает код: «подразделение «ИТ»», «навык „принтеры HP“ — уровень 4», «на смене»,
  «корпус Б», «2 открытые заявки», «решил 5 похожих».
- Уверенности нет, если разрыв с вторым местом меньше 15 % от лучшего балла, лучший балл не положительный
  или лидер не на смене → в причины лидера добавляется «нужно подтверждение диспетчера» (при аварии —
  «авария: нужно подтверждение диспетчера»). Выбор остаётся за диспетчером.

## Точки входа

| Что | Где |
|---|---|
| Шаг разбора `routing.recommend` (стадия `route`, `order 100`, `reads: fields, emergency`, `writes: assignees`) | `modules/routing/server/index.ts` |
| `GET /api/m/routing/candidates/:ticketId` (право `tickets.read`) | там же: `getTicket` → `getTicketFields` → `scoreCandidates` |
| Метрики `assignee_top1`, `assignee_top3` по `expected.assigneeTop3` | `evaluate()` шага |
| Данные инженеров | `data/engineers.json` (008) → `data.extra.engineers`, иначе демо-набор модуля |

## Тесты

```bash
npx vitest run modules/routing
```

- первый кандидат на примере заказчика (навык, смена, корпус), причины содержат все три фактора;
- корпус из заявки меняет порядок; загрузка снижает балл; пустой список инженеров → `[]`;
- малый разрыв → строка про подтверждение диспетчера; большой разрыв и лидер на смене → строки нет;
- `evaluate`: 1 при попадании в топ-1/топ-3, 0 при промахе;
- шаг пишет `assignees` на пустом черновике и берёт инженеров из `data.extra.engineers`;
- маршрут отдаёт трёх кандидатов по заявке из базы и падает понятной ошибкой на несуществующей заявке.

## Регистрация

`modules/registry.server.ts`: `import routing from './routing/server';` и `routing` в `serverModules`
(в алфавитном порядке). Веб-часть (`ticket.side`, страница «Специалисты») — отдельная задача.
