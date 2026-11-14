# Модуль `report-kb-gaps`

Что делает: отчёт О6 «Пробелы базы знаний» — заявки, где подходящая статья не найдена, частые симптомы без статьи и темы для пополнения базы; вывод «что это значит / что сделать» — модель `cheap` по фактам, при ошибке — шаблон.
Флаг фичи: `enabledByDefault: true`; выключение — `FEATURES_OFF=report-kb-gaps`.
Точки расширения: `reports` (`kb-gaps.articles`), подписчик `analysis.completed` → событие `report-kb-gaps.miss`, маршруты `GET /api/m/report-kb-gaps/`, `POST /api/m/report-kb-gaps/run`, `GET /api/m/report-kb-gaps/export?format=csv` (право `reports`), `drilldown` → фильтр заявок.
Данные: журнал `analysis.completed` (черновик с `knowledge`), событие `report-kb-gaps.miss` и поиск `searchKnowledge` для заявок без разбора; своей таблицы нет — журнал append-only и есть накопление.
Момент демо: руководитель видит «такой-то симптом — N заявок, статьи нет» и что написать в базу знаний.
