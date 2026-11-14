# Модуль `report-ai-effect`

Что делает: отчёт О5 «Эффект ИИ» — доля заявок без правок человеком, среднее число правок, время от подсказки ИИ до подтверждения и поля, которые человек исправляет чаще всего; сравнение «с ИИ / без ИИ» — только при наличии замеров, иначе честно `null`.
Флаг фичи: `enabledByDefault: true`; выключение — `FEATURES_OFF=report-ai-effect`.
Точки расширения: `reports` (`ai-effect.summary`), маршруты `GET /api/m/report-ai-effect/`, `POST /api/m/report-ai-effect/run`, `GET /api/m/report-ai-effect/export?format=csv` (право `reports`), `drilldown` → фильтр заявок.
Данные: журнал событий `ticket.field.set`, `ticket.field.corrected`, `ticket.confirmed` и реестр полей для подписей; своих таблиц нет.
Момент демо: показать, что ИИ заполняет поля без правок и где именно диспетчер его исправляет.
