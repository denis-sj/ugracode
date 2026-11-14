# Модуль `dispatcher-review` — проверка заявки диспетчером

Веб-часть: очередь `/queue` и проверка по шагам `/review?id=…` (критерий К3). Серверные маршруты —
[dispatcher-api.md](../../docs/map/features/dispatcher-api.md), карта интерфейса —
[dispatcher-review-ui.md](../../docs/map/features/dispatcher-review-ui.md).

- `web/QueuePage.tsx` — сводка, фильтры «Все / Сомнительные / Готовые / Аварии», поиск, сортировка
  «аварии → критические → по сроку», SSE `/api/events/stream` с откатом на опрос раз в 15 с,
  query `#/queue?status=…&emergency=true&assignee=…`.
- `web/QueuePreview.tsx` — стикер справа: цитата, поля с происхождением, кандидат из routing,
  «Подтвердить Enter» и «Открыть».
- `web/ReviewPage.tsx` + `web/ReviewFields.tsx` — 4 шага: обращение и след «Нашёл → Сверил → Спросил → Вам»,
  правка полей, топ-3 исполнителя, шаблон ответа; итог с `ProgressScale` и счётчиком действий.
- `web/format.ts` — чистые функции: `sortTickets`, `filterTickets`, `queueSummary`, `queueAction`,
  `ticketSignals`, `traceSteps`, `queueFiltersFromQuery`, `reviewTicketId`, `queueEventAction`,
  `formatDuration`, `diffValues`, `journalRows`.
- `web/parts.tsx` + `web/review.css` — плашки сроков, подсказки клавиш; цвета и анимации только из токенов
  `@ugra/ui`.
- Тесты: `tests/format.test.ts` (`npx vitest run modules/dispatcher-review`), дизайн —
  [case9-ui-design.md](../../docs/specs/case9-ui-design.md).

Не поддержано API: `replyDraft` и отправка ответа (шаг 4 — локальный шаблон), «Вернуть заявителю»
(скрыта до модуля сообщений), уверенность в списке заявок (догрузка деталей первых 24 строк).
