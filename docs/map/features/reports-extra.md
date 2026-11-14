# Карта фичи: отчёты О3, О4, О6, О7 (задачи 027–028)

Статус: active
Дата: 2026-11-14
Связано: [../README.md](../README.md), [../../specs/case9-core.md](../../specs/case9-core.md#39-отчёты), [../../specs/case9-features.md](../../specs/case9-features.md), [../../hackathon/case9-brief.md](../../hackathon/case9-brief.md), [reports-insights.md](reports-insights.md)

Четыре серверных модуля-отчёта по образцу О1/О2/О5. Каждый объявляет `ReportDef`, маршруты под
`/api/m/<id>/` (право `reports`), `facts()` для ИИ, `drilldown()` и выгрузку CSV. Веб-частей в задаче
нет: экраны рисует фронтенд-поток по [case9-ui-design.md](../../specs/case9-ui-design.md).

## Файлы

| Файл | Что там |
|---|---|
| `modules/report-sla/contracts.ts` | схемы О3: параметры `days/priority/assigneeId`, сводка, разрезы по приоритетам и подразделениям, худшие заявки |
| `modules/report-sla/server/compute.ts` | сроки реакции и решения по `reactDueAt`/`slaDueAt`, фактические времена из событий, нарушения, риск, топ-5 |
| `modules/report-workload/server/compute.ts` | текущие открытые по исполнителям, закрытые за период, среднее решение, перегруз, баланс подразделений |
| `modules/report-kb-gaps/server/compute.ts` | заявки без статьи: `analysis.completed` → `draft.knowledge`, событие `report-kb-gaps.miss`, поиск `searchKnowledge` для истории; темы и категории |
| `modules/report-kb-gaps/server/index.ts` | `ReportDef` + подписчик `analysis.completed`, публикующий `report-kb-gaps.miss` |
| `modules/report-emergency/server/compute.ts` | аварии (`isEmergency`), реакция, повторные аварии по технике/месту, ложные тревоги по `emergency.detected` |
| `modules/report-*/server/insight.ts` | `LlmPort.structured` уровня `cheap`, проверка «каждое число есть в фактах», шаблонный вывод |
| `modules/report-*/server/csv.ts` | CSV: BOM, `;`, экранирование, десятичная запятая |
| `modules/report-*/server/index.ts` | `ReportDef`, `facts()`, `drilldown()`, маршруты `GET /`, `POST /run`, `GET /export` |
| `modules/report-*/prompts/insight.v1.md` | промпты выводов (запрет считать и придумывать числа) |
| `modules/report-*/tests/` | контракт модуля, агрегаты на `MemoryStore`, факты, вывод, CSV, маршруты и 400 на чужие форматы |

## О3 «Сроки (SLA)»

- Параметры: `days` (1–365, по умолчанию 30), `priority` (уровень), `assigneeId`.
- Заявки периода — по `createdAt`. Решение: событие `ticket.status.changed` (`resolved`/`closed`,
  `resolvedAt`/`resolutionMinutes`), иначе `updatedAt` закрытой заявки.
- Реакция: `confirmedAt` или первое событие `ticket.assigned` / переход в `assigned`/`in_progress`.
  Заявки без таких событий (история из сида) честно попадают в «реакция не измерена», а не получают
  выдуманное время.
- Сводка: всего/закрыто/открыто/отменено, «в срок %» среди закрытых с известным сроком, нарушения
  (закрытые с просрочкой + открытые просроченные), под риском (срок в ближайшие 24 часа), средняя
  просрочка, средние реакции и решения, «реакция в срок %».
- Разрезы `byPriority` / `byDepartment`: заявки, закрытые с просрочкой, открытые просроченные,
  нарушения, «в срок %», среднее решение (и средняя просрочка для приоритетов).
- `worst` — топ-5 по величине просрочки: закрытые с опозданием и открытые с истёкшим сроком.
- `drilldown`: `late` → `{slaState: 'late'}`, `overdue` → `{slaState: 'overdue'}`, `at-risk` →
  `{slaState: 'at-risk'}`, `priority:<код>` → `{priority}`, `department:<id>` → `{departmentId}`,
  `ticket:<id>` → `{ticketId}`.

## О4 «Нагрузка инженеров»

- Параметры: `days` (1–365, по умолчанию 30), `departmentId`.
- «Открытые» — текущий портфель (статус из `new…in_progress`, без привязки к дате создания),
  «закрытые» — закрытые в периоде. Так отчёт отвечает «кого разгрузить», а не только «сколько сделали».
- Перегруз: открытых больше порога `workload.overloadOpen` из ссылочных настроек (по умолчанию 5).
- `byEngineer`: открыто/закрыто/всего, среднее решение, флаг перегруза, подразделение.
  Неназначенные заявки — отдельная строка «Не назначено» (в число инженеров не входит).
- `byDepartment`: инженеры, открыто/закрыто, доля открытых от всех, открытых на инженера,
  перегруженных инженеров.
- `drilldown`: `open` → `{open: true}`, `closed` → `{closed: true}`, `overload` → `{overloaded: true}`,
  `assignee:<id>` → `{assigneeId}`, `department:<id>` → `{departmentId}`.

## О6 «Пробелы базы знаний»

- Параметр `days`. Заявки периода (кроме `cancelled`).
- Источник истины по заявке: последний `analysis.completed` → `draft.knowledge`:
  - есть попадание `kind: 'article'` → статья найдена;
  - массив пуст/отсутствует → «статьи нет» (ошибка поиска в разборе тоже считается пробелом);
  - разбора нет → смотрим `report-kb-gaps.miss` от подписчика;
  - нет и его → ищем статью по базе знаний (`searchKnowledge({ text: симптом, category })`) и считаем
    найденной, если совпадение не ниже порога `knowledge.minScore` (по умолчанию 2). Порог важен:
    одно общее слово «принтер» статьёй не считается.
- Подписчик `analysis.completed` публикует `report-kb-gaps.miss` (`ticketId`, симптом, категория),
  когда статьи нет. Своей таблицы **нет**: журнал событий append-only и уже хранит накопление;
  миграция `0009` не понадобилась, `KernelStore` не менялся.
- `themes` — топ-10 симптомов без статьи: подпись, полный симптом (он же фильтр), категория, число
  заявок, доля от всех пробелов, пример заявки.
- `byCategory` — всего/без статьи/доля и самая частая тема категории.
- `drilldown`: `without-article` → `{hasArticle: false}`, `with-article` → `{hasArticle: true}`,
  `category:<код>` → `{category}`, `theme:<ключ>` → `{symptom, category}`.

## О7 «Аварии»

- Параметр `days`. Авария — `ticket.isEmergency`; доля считается от всех заявок периода.
- Реакция — как в О3 (подтверждение/назначение), средняя по авариям, где время известно.
- `hotspots` — техника (`equipmentId`) или место (`locationId`) с двумя и более авариями: подпись,
  число, доля от всех аварий, дата последней. Название техники — из поля `equipment` одной заявки.
- Ложные тревоги: события `emergency.detected` в периоде; `falseAlarms` = сигналы уровня `suspected`.
  Если событий в журнале нет — `null` («нет данных»), а не ноль.
- `recent` — последние 5 аварий периода для хронологии.
- `drilldown`: `emergency` → `{isEmergency: true}`, `repeated` → `{isEmergency: true, repeated: true}`,
  `false-alarms` → `{level: 'suspected'}`, `equipment:<id>` → `{equipmentId}`,
  `location:<id>` → `{locationId}`.

## Вывод ИИ и выгрузка

- У каждого отчёта `insightPromptId` = `modules/<id>/prompts/insight.v1.md`. `POST /run` зовёт
  `ports.llm.structured` с `tier: 'cheap'`; модель видит только `facts`. Числа в тексте сверяются
  с фактами; выдуманное число, ошибка модели или пустой ответ → шаблон (`source: 'template'`).
- `GET /` отдаёт отчёт с шаблонным выводом и не тратит вызов модели.
- CSV: BOM, разделитель `;`, десятичная запятая; `format` кроме `csv` → 400.
- У всех маршрутов право `reports` (руководитель и админ).

## Регистрация

```ts
// modules/registry.server.ts — по алфавиту, в массив и в export
import reportEmergency from './report-emergency/server';
import reportKbGaps from './report-kb-gaps/server';
import reportSla from './report-sla/server';
import reportWorkload from './report-workload/server';
// …и те же четыре имени в serverModules.
```

Веб-частей в задаче нет, `modules/registry.web.ts` не меняется.

## Проверки

```bash
npx tsc --noEmit
npx vitest run modules/report-sla modules/report-workload modules/report-kb-gaps modules/report-emergency
npx eslint modules/report-sla modules/report-workload modules/report-kb-gaps modules/report-emergency
```

- агрегаты: пустая база, одна заявка, границы периода, фильтры, разрезы, топы, отменённые заявки;
- факты непустые, ключевые числа совпадают с результатом;
- вывод: валидный текст принимается, выдуманное число и ошибка модели дают шаблон;
- CSV: BOM, заголовки, `;`, экранирование; маршруты: право `reports`, 400 на `pdf/xlsx`;
- `assertModuleContract` для всех четырёх модулей; подписчик О6 проверен отдельно.

## Ограничения

- Веб-экранов нет: `reportViews` и страницы рисует фронтенд-поток.
- Время реакции в истории из `history-seed` известно только там, где есть переход в «назначена»
  (несколько открытых заявок); у остальных отчёт честно показывает «реакция не измерена».
  На живом разборе реакция появляется из `ticket.assigned`.
- О4 считает «открытые» на момент запуска (портфель), а не «сколько было открыто в каждом дне периода».
- О6 без сида базы знаний считает все заявки пробелами: пустая база — это тоже пробел.
- `drilldown` возвращает расширенные фильтры (`slaState`, `open/closed`, `overloaded`, `hasArticle`,
  `symptom`, `level`, `repeated`), которых пока нет в `GET /api/tickets`: очередь должна научиться
  их читать — отдельная задача фронтенда.
- Таблица пробелов О6 не создавалась: накопление идёт в `event_log`; при переходе на PostgreSQL
  отдельная таблица не нужна, но при росте журнала понадобится индекс по `type`/`ticket_id`.
