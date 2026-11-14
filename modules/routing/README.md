# Модуль `routing`

Что делает: шаг `routing.recommend` считает кодом топ-3 исполнителя с причинами «почему он» и кладёт их в `assignees`; маршрут `GET /api/m/routing/candidates/:ticketId` пересчитывает кандидатов по заявке из базы.
Флаг фичи: `enabledByDefault: true`; выключение — `FEATURES_OFF=routing`.
Точки расширения: `steps` (стадия `route`, `order 100`, читает `fields` и `emergency`, пишет `assignees`), `routes` (кандидаты для карточки заявки), `evaluate` шага (метрики `assignee_top1` / `assignee_top3`); веса и карта «категория → подразделение» — в `server/scoring.ts`, данные инженеров — `data/engineers.json` (008) или демо-набор в `server/engineers.ts`.
Момент демо: карточка заявки «корпус Б, каб. 312, принтер HP» — три кандидата с объяснением, первый на смене и с навыком «принтеры HP»; диспетчер выбирает одним кликом.
