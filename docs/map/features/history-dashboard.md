# Карта фичи: история заявок и дашборд О0 (015)

Статус: active
Дата: 2026-11-14
Связано: [../README.md](../README.md), [../../specs/case9-core.md](../../specs/case9-core.md#39-отчёты), [../../specs/case9-features.md](../../specs/case9-features.md), [../../specs/case9-ui-design.md](../../specs/case9-ui-design.md), [../../hackathon/case9-brief.md](../../hackathon/case9-brief.md), [../../tasks/015-history-dashboard.md](../../tasks/015-history-dashboard.md)

Два модуля: `history-seed` наполняет базу синтетической историей за 6 месяцев, `reports-dashboard`
считает по ней отчёт О0 и рисует экран руководителя. Оба работают через `KernelStore`; своих таблиц нет.

## Файлы

| Файл | Что там |
|---|---|
| `modules/history-seed/server/generator.ts` | детерминированный генератор (mulberry32, фиксированное зерно): рабочие часы 8–19, пик в понедельник, 3 аварии, 7 обращений по принтеру в каб. 312, статусы closed/resolved/cancelled + несколько открытых, 2–6 полей, обращение и событие `ticket.status.changed` |
| `modules/history-seed/server/index.ts` | `defineModule`: `seed({db,data,clock})` пишет через `saveTicket`/`saveTicketFields`/`saveAppeal`/`appendEvent`; идемпотентно — при ≥300 заявках в базе пропускает |
| `modules/reports-dashboard/contracts.ts` | zod-схемы параметров и результата отчёта О0 (общие для сервера и веба) |
| `modules/reports-dashboard/server/overview.ts` | расчёт: период и прошлый период, плитки, разрезы, тепловая карта, горячие точки, SLA, шаблонные выводы |
| `modules/reports-dashboard/server/index.ts` | `ReportDef` `dashboard.overview`, `facts()` и маршрут `GET /api/m/reports-dashboard/overview` (право `reports`) |
| `modules/reports-dashboard/web/` | страница `/dashboard` (manager/admin), виджеты `dashboard.tiles` и `dashboard.main` на компонентах `@ugra/ui` (`StatTile`), клиент маршрута и форматирование ▲/▼ |
| `modules/history-seed/tests/`, `modules/reports-dashboard/tests/` | генератор, идемпотентность сида, расчёт отчёта, тест-контракт обоих модулей |

## История заявок

- Данных 600 заявок за 6 месяцев от `clock.now()`. День выбирается взвешенно по дню недели
  (понедельник — 2,2 против 1,1–1,35 в остальные будни, выходные почти пустые), час — 8–18
  с пиком 9–11 и 14–16. Корпус — по нагрузке (ПРОМ реже офисных), кабинет — из CMDB этого
  корпуса; часть обращений по печати в корпусе Б тянется к «больному» принтеру 312.
- Особые заявки: 3 аварии (`isEmergency`, приоритет `emergency`) и 7 обращений по принтеру
  из `cab-b-312` (берётся из CMDB по кабинету 312). Остальные — случайные категории из
  `data/dictionaries.json`.
- Статусы: закрытые и решённые, ~13 % отменённых, 4 открытые. Время решения хранится в
  `payload.resolutionMinutes` события `ticket.status.changed` — отдельной колонки `resolvedAt` в контракте нет.
- Исполнитель выбирается из `data/engineers.json` по подразделению категории и корпусу;
  техника — из `data/cmdb.json` по типу и корпусу. Ссылки на инженеров, категории и технику
  проверяются тестом.
- `locationId` строится по формуле `cab-<код корпуса>-<кабинет>` — так же, как в
  `packages/db/src/seed/load-data.ts`; по нему отчёт считает корпуса и горячие точки без чтения полей.

## Отчёт О0

Параметры: `days` (1–365), либо `from`/`to`; фильтры `category`, `assigneeId`, `channel`,
`building`, `status` сочетаются. Результат: период и такой же прошлый период, итоги и ▲/▼,
среднее время решения, разрезы по приоритетам (все 5 уровней, включая нули), категориям,
корпусам, исполнителям и статусам, тепловая карта «день × час» (Пн–Пт, 8–17), топ-5 горячих
точек (корпус + кабинет) и тексты `insights`: `summary`, `priorities`, `heatmap`, `sla`,
`hotspots.meaning/action`.

- Цифры считает код. Тексты — шаблоны по фактам; ИИ-вывод подключается агентом `analyst`
  (задача 021), до него блок честно подписан «вывод собран по фактам шаблоном».
- SLA: нарушением считается закрытая заявка, решённая позже `slaDueAt`, и открытая, у которой
  срок уже прошёл. «В срок, %» — доля закрытых без нарушения.
- `facts()` отдаёт 9 коротких пар label/value — только их увидит модель, когда появится вывод.
- Фильтр по каналу читает `appeal` каждой заявки периода (в `ticket` колонки канала нет);
  без фильтра обращения не читаются.

## Экран

`/dashboard` для manager/admin по дизайну [case9-ui-design.md](../../specs/case9-ui-design.md):
период «Смена / 7 / 30 / квартал» + выбор дат, строка фильтров, меню «Выгрузить», 5 плиток
с ▲/▼, график по приоритетам, тепловая карта, отчёт «Горячие точки» с блоками
«Что это значит» и «Что сделать». Виджеты `dashboard.tiles` и `dashboard.main` показываются
на стартовом экране роли.

- Стили — только классы и токены `packages/ui` (`var(--color-…)`, `var(--space-…)`);
  своих цветов и длительностей анимаций нет.
- Меню выгрузки (Excel, PDF, CSV, почта, еженедельная сводка) нарисовано, но пункты `disabled`:
  серверных маршрутов выгрузки пока нет (они в задачах отчётов О1–О8).
- Плитки: «Обращений», «Открытых», «Аварий», «В срок», «Решение, среднее». Показателя
  «ИИ без правок» нет в данных — вместо него «В срок», чтобы не выдумывать цифру.

## Точки входа

| Что | Где |
|---|---|
| Сид истории | `modules/history-seed/server/index.ts` → `seedHistory` через `KernelStore` |
| Генератор без базы | `generateHistory(input)` в `modules/history-seed/server/generator.ts` |
| Отчёт по HTTP | `GET /api/m/reports-dashboard/overview?days=30&category=printer` |
| Отчёт как `ReportDef` | `overviewReport` (`dashboard.overview`) в `modules/reports-dashboard/server/index.ts` |
| Экран | `#/dashboard`, компонент `DashboardPage` |
| Виджеты | слоты `dashboard.tiles`, `dashboard.main` |

Регистрация (одна строка в каждый манифест):

```ts
// modules/registry.server.ts
import reportsDashboard from './reports-dashboard/server';
import historySeed from './history-seed/server';
// в массив serverModules и в export — по алфавиту

// modules/registry.web.ts
import reportsDashboardWeb from './reports-dashboard/web';
// в массив webModules и в export
```

## Проверки

```bash
npx vitest run modules/history-seed modules/reports-dashboard
npx tsc --noEmit
npx vite build --config apps/web/vite.config.ts
```

- генератор: два прогона с одним зерном совпадают, 600 заявок, ≥6 обращений по принтеру в 312,
  ровно 3 аварии, валидные ссылки, рабочие часы, доля отмен 10–15 %, пик в понедельник;
- сид: 600 заявок в `MemoryStore`, повторный запуск не удваивает, события и обращения на месте;
- отчёт: пустая база, одна заявка, авария + просрочка + топ горячих точек, период и прошлый
  период, фильтр канала, тепловая карта, непустые `facts` и `insights`;
- тест-контракт обоих модулей.

## Особенности и что осталось

- `history-seed` — данные, а не фича: `enabledByDefault: false`, но `pnpm seed` добавляет его
  в список сида всегда (`packages/db/src/seed/index.ts`), иначе демо-база осталась бы без истории.
- Экран использует `@ugra/ui` (`StatTile`, классы `ugra-card`) и токены светлой темы из
  `packages/ui/src/tokens.css`. В `apps/web/vite.config.ts` нужны алиасы `@ugra/ui` и `react` —
  они приходят с веткой оболочки; без них веб-модуль не собирается в бандл.
- Горячие точки показывают корпус, кабинет, число заявок и долю. Названия оборудования и
  простой в отчёте не выводятся: в `ticket` нет ни названия техники, ни времени простоя —
  нужен джойн с CMDB или колонка, это отдельная задача.
- Выгрузка и «присылать сводку» ждут серверных маршрутов; сравнение с прошлым периодом уже
  считается (`previousTotals`, `deltas`).
