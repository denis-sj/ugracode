# Модуль `dispatcher-review` — проверка заявки диспетчером

Веб-часть: очередь `/queue` и карточка проверки (критерий К3). Серверные маршруты — [dispatcher-api.md](../../docs/map/features/dispatcher-api.md), карта интерфейса — [dispatcher-review-ui.md](../../docs/map/features/dispatcher-review-ui.md).

- `web/QueuePage.tsx` — сводка цифрами, фильтры, поиск, сортировка «аварии → критические → по сроку», подсветка изменившихся строк, опрос очереди раз в 15 с.
- `web/TicketCard.tsx` — вкладки «Поля»/«Журнал», правка одного поля (список для справочников), `Enter` — подтвердить и назначить, `Tab` — только спорные поля, `Esc` — закрыть.
- `web/format.ts` — чистые функции: `sortTickets`, `formatDuration`, `ticketDeadlines`, `diffValues`, `journalRows`, `lastReturn`, `reviewFieldKeys`.
- `web/parts.tsx` + `web/review.css` — приоритет полосками, плашки сроков, подсказки клавиш; цвета и анимации только из токенов `@ugra/ui`.
- Тесты чистых функций: `tests/format.test.ts` (`npx vitest run modules/dispatcher-review`), дизайн — [case9-ui-design.md](../../docs/specs/case9-ui-design.md).
