# Модуль `report-workload`

Что делает: отчёт О4 «Нагрузка инженеров» — у кого сколько открытых и закрытых заявок, среднее время решения, кто перегружен (больше порога открытых) и как сбалансированы подразделения; вывод «что это значит / что сделать» — модель `cheap` по фактам, при ошибке — шаблон.
Флаг фичи: `enabledByDefault: true`; выключение — `FEATURES_OFF=report-workload`.
Точки расширения: `reports` (`workload.load`), маршруты `GET /api/m/report-workload/`, `POST /api/m/report-workload/run`, `GET /api/m/report-workload/export?format=csv` (право `reports`), `drilldown` → фильтр заявок.
Данные: заявки и события `ticket.status.changed` из `KernelStore`, имена — `data/engineers.json`; порог перегруза — настройка `workload.overloadOpen` (по умолчанию 5); своих таблиц нет.
Момент демо: руководитель видит перегруженного инженера и свободного, которому можно передать заявки.
