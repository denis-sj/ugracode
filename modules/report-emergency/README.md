# Модуль `report-emergency`

Что делает: отчёт О7 «Аварии» — число и доля аварийных заявок, среднее время реакции, повторные аварии по технике и месту, ложные тревоги по журналу и последние аварии для хронологии; вывод «что это значит / что сделать» — модель `cheap` по фактам, при ошибке — шаблон.
Флаг фичи: `enabledByDefault: true`; выключение — `FEATURES_OFF=report-emergency`.
Точки расширения: `reports` (`emergency.summary`), маршруты `GET /api/m/report-emergency/`, `POST /api/m/report-emergency/run`, `GET /api/m/report-emergency/export?format=csv` (право `reports`), `drilldown` → фильтр заявок.
Данные: заявки (`isEmergency`, `equipmentId`, `locationId`), события `ticket.assigned`, `ticket.status.changed` и `emergency.detected`; своих таблиц нет.
Момент демо: руководитель видит повторные аварии на одной единице техники и сколько тревог оказались ложными.
