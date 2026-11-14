# Карта фичи: хаб отчётов О1–О7 (`reports-hub`)

Статус: active
Дата: 2026-11-14
Связано: [../README.md](../README.md), [../../specs/case9-ui-design.md](../../specs/case9-ui-design.md), [../../hackathon/case9-brief.md](../../hackathon/case9-brief.md), [reports-extra.md](reports-extra.md), [reports-insights.md](reports-insights.md)

Страница `/reports` для руководителя вместо заглушки: карточки семи отчётов на уже существующих
маршрутах серверных модулей. Сервер, контракты и `packages/ui` не менялись. Дизайн — в стиле
дашборда (`reports-dashboard`): светлая тема по умолчанию, тёмная через токены, никаких выдуманных
цифр — только ответ API.

## Файлы

| Файл | Что там |
|---|---|
| `modules/reports-hub/web/index.ts` | `defineWebModule` id `reports-hub`: `/reports`, роли `manager`/`admin`, `nav.section = «Руководитель»` |
| `modules/reports-hub/web/format.ts` | `REPORTS`, `runBody`, `csvUrl`, `reportTable`, `numberRows`, `reportFacts`, `insightText`/`insightView`, `isReportError`, `formatMetric` |
| `modules/reports-hub/web/ReportsPage.tsx` | карточки О1–О7, период 7/30/90, дата смены, загрузка, ошибка с повтором, результат и CSV |
| `modules/reports-hub/web/reports.css` | стили на переменных `@ugra/ui` (стекло, отступы, статусные цвета) |
| `modules/reports-hub/tests/format.test.ts` | разбор реальных форм ответов всех семи модулей, пустые и битые данные |
| `modules/registry.web.ts` | одна добавленная регистрация: import, элемент `webModules`, экспорт |

## Отчёты и маршруты

| Код | id модуля | `POST /api/m/<id>/run` | CSV |
|---|---|---|---|
| О1 | `report-shift` | `{ date: 'ГГГГ-ММ-ДД' }` (по умолчанию сегодня) | `GET /api/m/report-shift/export?format=csv&date=…` |
| О2 | `report-hotspots` | `{ days }` | `GET /api/m/report-hotspots/export?format=csv&days=…` |
| О3 | `report-sla` | `{ days }` | `GET /api/m/report-sla/export?format=csv&days=…` |
| О4 | `report-workload` | `{ days }` | `GET /api/m/report-workload/export?format=csv&days=…` |
| О5 | `report-ai-effect` | `{ days }` | `GET /api/m/report-ai-effect/export?format=csv&days=…` |
| О6 | `report-kb-gaps` | `{ days }` | `GET /api/m/report-kb-gaps/export?format=csv&days=…` |
| О7 | `report-emergency` | `{ days }` | `GET /api/m/report-emergency/export?format=csv&days=…` |

Период по умолчанию — 30 дней; переключатель 7/30/90 меняет тело следующего запроса. Результат
хранит свой период: подпись и CSV остаются честными, даже если переключатель уже переставили.

## Как читается ответ

- Ответ `run` — `{ report, facts, insight }` (`insight`: `meaning`, `actions`, `source`, `model`).
- Таблица выбирается по форме `report`: `byAssignee` (О1), `rows` (О2), `byDepartment` + `summary.slaOnTimePercent` (О3), `byEngineer` (О4), `totals.correctionsByField` (О5), `themes` (О6), `hotspots` (О7).
- Показываются первые 10 строк; если строк больше — подпись «полностью в CSV».
- `facts` — до 4 плиток; факты с подписью «Период…» пропускаются, период показан отдельно.
- `insights` (массив строк) поддерживается как запасной формат; `insight.meaning` важнее.
- Незнакомый формат, `null` или строка — `<details>` с JSON, без падения.
- Ошибка — `{ error }` / `{ ok: false }` даже при HTTP 200: карточка показывает текст и «Повторить».

## Ограничения

- О8 «Прогноз нагрузки» не подключён: серверного модуля нет, цифры не выдумываем.
- Отдельного маршрута «все отчёты разом» нет: каждый отчёт считается по кнопке, чтобы не ждать ИИ семь раз.
- Права проверяет API (`rights: reports`); страница дополнительно ограничена ролями `manager` и `admin`.
- Формат CSV задаёт серверный модуль; на экране только ссылка, содержимое не парсится.
