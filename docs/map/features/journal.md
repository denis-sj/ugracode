# Карта фичи: журнал действий диспетчера (экран 11)

Статус: active
Дата: 2026-11-14
Связано: [../README.md](../README.md), [../../specs/case9-ui-design.md](../../specs/case9-ui-design.md),
[../../specs/case9-features.md](../../specs/case9-features.md), [../../specs/case9-core.md](../../specs/case9-core.md),
[../../hackathon/case9-brief.md](../../hackathon/case9-brief.md), [ui-shell.md](ui-shell.md),
[dispatcher-review-ui.md](dispatcher-review-ui.md)

Веб-экран `/journal` («Журнал действий», дизайн 4, макет `Log.dc.html`) для `dispatcher`, `admin`,
`manager`. Модуль только читает общий журнал ядра — своих событий, шагов и таблиц у него нет.

## Файлы

| Где | Что |
|---|---|
| `modules/journal/web/index.ts` | `defineWebModule` id `journal`, страница `/journal`; строка в `modules/registry.web.ts` |
| `modules/journal/web/JournalPage.tsx` | данные, фильтры, строки, сводка, пустые состояния, `useListMotion`, `data-reveal` |
| `modules/journal/web/format.ts` | `eventGroups`, `filterEvents`, `diffPayload`, `valueDiff`, `topCorrectedFields`, `eventTitle`, `actorLabel`, `relativeTime`, `toJournalRows` |
| `modules/journal/web/journal.css` | стили только на токенах `@ugra/ui`; тёмная тема наследуется |
| `modules/journal/tests/format.test.ts` | успешные сценарии, пустые данные и битые payload |

## Данные

- `GET /api/events?limit=300` — плоский журнал ядра (`type`, `at`, `actor`, `ticketId`, `payload`),
  сервер отдаёт по возрастанию времени; `toJournalRows` сортирует новые сверху.
- `GET /api/users` — имя автора события (`actor.id`); без справочника — «ИИ», «система» или «человек».
- `GET /api/tickets?limit=200` — номер заявки для ссылки и поиска; кэшируется в состоянии страницы
  и не перезапрашивается при смене фильтров.
- Ошибка справочников журнал не роняет: строки показываются с кодом заявки/автора.
- «Было → стало» у `ticket.field.corrected` берётся из `payload.previous` (или `aiValue`) → `payload.value`;
  у `ticket.status.changed` — `from` → `to`. Коды справочников и статусов заменяются подписями.

## Фильтры и сводка

- **Вкладки:** Все / Правки ИИ (`ticket.field.corrected`) / Подтверждения (`ticket.confirmed`,
  `ticket.status.changed`) / Аварии (`emergency.detected`, `mass-incident.opened`). Числа на вкладках —
  в выбранном периоде и с учётом поиска.
- **Поиск:** по подписи события, автору, номеру заявки, названию поля, описанию и значениям «было → стало».
- **Период:** «Сегодня» — с местной полуночи, «7 дней» — последние 168 часов; по умолчанию 7 дней,
  чтобы журнал не пустел на защите.
- **Что чаще исправляют:** топ-5 полей по `ticket.field.corrected` за выбранный период и поиск;
  процент — доля от всех правок. Правок нет — пустое состояние без выдуманных цифр.
- **Строка:** время (`relativeTime`, точное время в `title`), автор с точкой цвета события,
  событие и «было → стало» с подсветкой отличающихся слов, ссылка `#/review?id=…`.

## Анимации

`useListMotion` на контейнере строк, `data-reveal` на шапке и сводке; поверхности — `Card` из `@ugra/ui`.
Своих GSAP/CSS-анимаций появления нет — правила [animations.md](../../rules/animations.md).

## Тесты

```bash
npx vitest run modules/journal
```

Покрыто: подписи автора и времени, заголовки событий (включая неизвестный тип и пустой payload),
диффы (previous/value, aiValue/value, from/to, одинаковые значения, мусор), сортировка, подписи
справочников, вкладки и поиск, периоды, топ-5 полей, битые события.

## Только журнал действий (2026-11-14)

По решению владельца на экране одна таблица «Журнал действий» за 7 дней: без блока «ИИ предложил → человек исправил»,
без карточки «Что чаще исправляют» и без вкладок-фильтров. Правки полей видны строками таблицы («было → стало»).
Функции `topCorrectedFields`, `correctedSummary`, `splitJournal` в `format.ts` остались для отчётов и тестов.
