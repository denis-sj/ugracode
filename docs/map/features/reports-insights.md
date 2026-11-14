# Карта фичи: отчёты О2, О1, О5 с выводами (021)

Статус: active
Дата: 2026-11-14
Связано: [../README.md](../README.md), [../../specs/case9-core.md](../../specs/case9-core.md#39-отчёты), [../../specs/case9-features.md](../../specs/case9-features.md), [../../specs/case9-agent-harness.md](../../specs/case9-agent-harness.md), [../../hackathon/case9-brief.md](../../hackathon/case9-brief.md), [../../history/2026-11.md](../../history/2026-11.md), [history-dashboard.md](history-dashboard.md)

Три серверных модуля-отчёта. Каждый объявляет `ReportDef`, HTTP-маршруты под `/api/m/<id>/`
(право `reports`), факты для ИИ и выгрузку в CSV. Веб-части в этой задаче нет: экраны отчётов
рисует фронтенд-поток по `docs/specs/case9-ui-design.md`.

## Файлы

| Файл | Что там |
|---|---|
| `modules/report-hotspots/contracts.ts` | zod-схемы О2: параметры `days/building/category`, строки топ-10, результат, ответ `run` с фактами и выводом |
| `modules/report-hotspots/server/compute.ts` | группировка заявок по `equipmentId` (иначе по `cab-<корпус>-<кабинет>`), доля, среднее время решения, прошлый период и тренд, топ-10 |
| `modules/report-hotspots/server/insight.ts` | вызов `LlmPort.structured` уровня `cheap`, проверка «каждое число есть в фактах», шаблонный вывод |
| `modules/report-hotspots/server/csv.ts` | CSV: BOM, `;`, экранирование, десятичная запятая |
| `modules/report-hotspots/server/index.ts` | `ReportDef` `hotspots.equipment`, `facts()`, `drilldown()`, маршруты `GET /`, `POST /run`, `GET /export` |
| `modules/report-hotspots/prompts/insight.v1.md` | промпт вывода О2 (запрет считать и придумывать числа) |
| `modules/report-shift/…` | то же для О1: контракты, расчёт смены, вывод, CSV, маршруты, промпт |
| `modules/report-ai-effect/…` | то же для О5: чтение журнала событий, сравнение «с ИИ / без ИИ», вывод, CSV, маршруты, промпт |
| `modules/report-*/tests/` | контракт модуля, агрегаты на `MemoryStore`, `facts`, проверка чисел в выводе, CSV, маршруты и 400 на чужие форматы |
| `modules/report-hotspots/tests/integration.test.ts` | история из `history-seed` → О2 находит принтер в каб. 312 |

## О2 «Горячие точки оборудования»

- Параметры: `days` (1–365, по умолчанию 30), `building` (подпись «Б» или код места), `category`.
- Точка = единица техники (`ticket.equipmentId`), а без неё — кабинет. Подпись техники берётся из
  поля `equipment` одной заявки группы, поэтому в таблице видно «HP LaserJet … · Корпус Б · каб. 312».
- Строка: корпус, кабинет, число заявок, доля от всех заявок периода, среднее время решения,
  число заявок в прошлом периоде и тренд. Таблица — топ-10; при равном числе заявок техника
  идёт выше кабинета (у неё понятнее причина повтора).
- Время решения — из события `ticket.status.changed` (`payload.resolutionMinutes` / `resolvedAt`),
  иначе из `updatedAt` закрытой заявки (так же, как в О0).
- `drilldown(key)` возвращает `{ days, building, cabinet, category, equipmentId }` — фильтр для
  очереди и виджета истории оборудования.

## О1 «Сводка смены»

- Параметр `date` (`ГГГГ-ММ-ДД`), по умолчанию — сегодняшний день по `ClockPort`. Смена —
  календарный день, границы считаются в локальной зоне сервера.
- Заявка смены: создана, изменена или закрыта в этот день. Итоги: всего, новые (созданные),
  закрытые, аварии, нарушения срока и «в срок %» (среди закрытых в смену).
- `byAssignee`: всего/открыто/закрыто и среднее время решения по исполнителям; имена —
  из `data/engineers.json` (как в О0), без файла показывается id.
- `attention`: просроченные (открытые с `slaDueAt` раньше текущего момента или конца дня для
  прошлой даты) и ждущие проверки (`in_review`). В ответе первые 20 строк и точные счётчики.
- `drilldown`: `overdue` → `{ date, overdue: true }`, `waiting-review` → `{ date, status: 'in_review' }`,
  `assignee:<id>` → `{ date, assigneeId }`, `emergency` → `{ date, isEmergency: true }`.

## О5 «Эффект ИИ»

- Параметр `days` (1–365, по умолчанию 30). Источник — журнал событий, своих таблиц нет:
  - `ticket.field.set` — ИИ предложил значение поля (числитель «полей предложено»);
  - `ticket.field.corrected` — человек исправил (числитель правок);
  - `ticket.confirmed` — подтверждение диспетчером; время считается от **первой** подсказки ИИ
    по заявке (даже если она была до периода) до подтверждения.
- «Заявка с ИИ» — у неё есть хотя бы одно `ticket.field.set` в периоде. «Без правок» — ни одного
  `ticket.field.corrected` в периоде. Отсюда доля без правок и среднее число правок на заявку.
- `correctionsByField` — топ-10 полей по числу исправлений, подписи из реестра полей.
- Сравнение «с ИИ / без ИИ»: сторона «с ИИ» заполняется фактами, сторона «без ИИ» — `null` и
  `source: 'none'`, пока замеров ручного режима нет (модуль `ai-vs-manual`, задача 017).
  Цифра не выдумывается: в фактах честно «нет данных».
- `drilldown`: `without-edits` → `{ days, corrected: false }`, `edited` → `{ days, corrected: true }`.

## Вывод ИИ: что это значит / что сделать

- У каждого `ReportDef` есть `insightPromptId` (`modules/<id>/prompts/insight.v1.md`).
- `POST /api/m/<id>/run` считает отчёт, собирает `facts()` и зовёт `ports.llm.structured`
  с `tier: 'cheap'` и схемой `{ insight: string, actions: string[] }`; модель видит **только факты**.
- Проверка кодом: из текста вывода и действий вынимаются все числа (`\d+([.,]\d+)?`), каждое
  обязано встретиться в подписи или значении факта. Выдуманное число, ошибка модели, пустой
  ответ или отсутствие ключа → шаблонный вывод по цифрам отчёта (`source: 'template'`).
  Округлять самому нельзя: «13» при факте «12,5» не пройдёт.
- `GET /api/m/<id>/` отдаёт тот же отчёт с шаблонным выводом и не тратит вызов модели.

## API и выгрузка

| Метод и путь | Что делает |
|---|---|
| `GET /api/m/report-hotspots/` | О2 с шаблонным выводом; query: `days`, `building`, `category` |
| `POST /api/m/report-hotspots/run` | О2 + вывод ИИ; body: те же параметры |
| `GET /api/m/report-hotspots/export?format=csv&days=30` | CSV (BOM, `;`); другие форматы — 400 |
| `GET /api/m/report-shift/`, `POST /run`, `GET /export` | О1; query/body: `date` |
| `GET /api/m/report-ai-effect/`, `POST /run`, `GET /export` | О5; query/body: `days` |

- У всех маршрутов право `reports` (руководитель и админ); проверяет общий обработчик сервера.
- Ответ `run`: `{ report, facts: [{ label, value }], insight: { meaning, actions, source, model } }`.
- CSV отдаётся строкой с BOM (`\uFEFF`) и разделителем `;` — Excel открывает без мастера.
  PDF/Excel-файл не поддерживаются: на `format` кроме `csv` маршрут отвечает 400.
- `GET /api/m/<id>` в терминах модульного роутера — это путь `/`, то есть фактический URL
  `/api/m/<id>/` (маршрутизатор склеивает `/api/m/${id}` + путь модуля и требует ведущий `/`).

## Регистрация

```ts
// modules/registry.server.ts — по алфавиту, в массив и в export
import reportAiEffect from './report-ai-effect/server';
import reportHotspots from './report-hotspots/server';
import reportShift from './report-shift/server';
```

Веб-части в этой задаче нет, `modules/registry.web.ts` не меняется.

## Проверки

```bash
npx tsc --noEmit
npx vitest run modules/report-hotspots modules/report-shift modules/report-ai-effect
npx eslint modules/report-hotspots modules/report-shift modules/report-ai-effect
```

- агрегаты: пустая база, одна заявка, период и прошлый период, топ-10, фильтры, смена дня,
  доля правок и время до подтверждения;
- `facts()` непустые, ключевые числа совпадают с результатом;
- вывод: валидный текст с числами из фактов принимается, выдуманное число и ошибка модели
  дают шаблон; запятая «12,5» из факта разрешена, округление «13» — нет;
- CSV: BOM, заголовки, `;`, экранирование кавычек и переводов строк;
- маршруты: право `reports`, 400 на `format=pdf/xlsx`, CSV-строка на `format=csv`;
- `assertModuleContract` для всех трёх модулей;
- история из `history-seed`: О2 ставит принтер из каб. 312 в топ.

## Ограничения и что осталось

- Веб-экранов отчётов в задаче нет: `reportViews` и страницы рисует фронтенд-поток.
- Сравнение «без ИИ» в О5 всегда `null`, пока `ai-vs-manual` (017) не начнёт писать замеры.
- «Простой оборудования» в О2 не считается: в заявке нет времени простоя, только время решения.
  Название техники берётся из поля `equipment` одной заявки группы, а не из CMDB.
- CSV — единственный формат выгрузки; PDF и Excel-файл отклоняются с 400.
- Ответ CSV отдаётся как `text/plain; charset=utf-8` (маршрут модуля не управляет заголовками);
  BOM достаточно, чтобы Excel распознал кодировку.
- `PolzaLlm.structured` пока не подгружает текст промпта по `promptId` (отправляет только id и
  `vars`). Поэтому ключевое правило «только числа из фактов» продублировано в `vars.rules`,
  а файл промпта остаётся источником версии. Подключение файла — правка `packages/adapters`,
  вне зоны этой задачи.
- `drilldown` возвращает расширенный фильтр (`corrected`, `overdue`, `date`), которого пока нет
  в `GET /api/tickets`: очередь должна научиться его читать — отдельная задача фронтенда.
