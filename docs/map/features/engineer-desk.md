# Карта фичи: рабочее место инженера (018, экран 4.6)

Статус: active
Дата: 2026-11-14
Связано: [../README.md](../README.md), [../../specs/case9-ui-design.md](../../specs/case9-ui-design.md#46-инженер), [../../hackathon/case9-brief.md](../../hackathon/case9-brief.md), [knowledge.md](knowledge.md), [dispatcher-review-ui.md](dispatcher-review-ui.md)

Экран инженера замыкает цикл заявки: назначенная задача → диагностика по статье базы знаний →
запись результата → `resolved` и подтверждение заявителем. Веб-часть, серверных маршрутов у модуля нет.

## Файлы

| Файл | Что там |
|---|---|
| `modules/engineer-desk/web/index.ts` | `defineWebModule id='engineer-desk'`, страница `/tasks` (`engineer`, `admin`), без виджетов |
| `modules/engineer-desk/web/EngineerDeskPage.tsx` | список задач, карточка, диагностика, чек-лист с сохранением, похожие, результат, вкладка «База знаний» с вопросом агенту, диалоги продления и возврата |
| `modules/engineer-desk/web/format.ts` | чистые функции экрана (см. ниже) |
| `modules/engineer-desk/web/engineer-desk.css` | стили на токенах `@ugra/ui`, светлая тема, `prefers-reduced-motion` |
| `modules/engineer-desk/tests/format.test.ts` | тесты чистых функций |
| `modules/engineer-desk/README.md` | описание модуля и ограничения API |

## Маршруты API

| Что | Запрос | Право |
|---|---|---|
| мои задачи | `GET /api/tickets?assigneeId=<user.id>&limit=200` | `tickets.read` |
| карточка | `GET /api/tickets/:id` | `tickets.read` |
| взять в работу | `POST /api/tickets/:id/transition` `{ to: 'in_progress' }` | `tickets.transition` |
| записать результат | `POST /api/tickets/:id/resolution` `{ text }` | `tickets.transition` |
| продлить срок | `POST /api/tickets/:id/deadline` `{ slaDueAt, reason }` | `tickets.edit` — **у инженера нет** |
| вернуть диспетчеру | `POST /api/tickets/:id/transition` `{ to: 'in_review' }` | `tickets.transition` |
| база знаний | `GET /api/m/knowledge/search?q=…` | `tickets.read` |
| шаги статьи у заявки | `GET /api/m/knowledge/tickets/:id/steps` | `tickets.read` |
| отметить шаг | `POST /api/m/knowledge/tickets/:id/steps` `{ articleId, stepIndex, done }` | `tickets.transition` |
| вопрос базе знаний | `POST /api/m/knowledge/ask` `{ question }` | `tickets.read` |
| статья по id | `GET /api/m/knowledge/articles/:id` | `tickets.read` |

## Чистые функции

| Функция | Правило |
|---|---|
| `myTasks(tickets, userId)` | только `assigneeId = userId` и статусы `assigned`/`in_progress` |
| `sortMyTasks(tickets)` | ближайший срок (`reactDueAt`/`slaDueAt`) → приоритет → номер; без срока — в конце |
| `statusActions(status)` | `assigned` → взять/вернуть; `in_progress` → выполнить/продлить/вернуть; иначе только чтение |
| `dueState(iso, now)` | «осталось 3 ч 26 мин», `danger` при просрочке, `warn` ≤ 15 минут, битая дата → `null` |
| `taskEquipment` / `taskPlace` / `taskTitle` | поля `equipment`, `model`, `building`, `cabinet`, `symptoms`, `object`; пустое не рисуем |
| `knowledgeQuery(fields, category)` | симптомы + объект + оборудование + модель + код ошибки, обрезка до 220 символов |
| `pickArticle(articles, query)` | совпадение слов по началу (как в `knowledge`), пустая выдача → `null` |
| `recurringEquipmentCount(tickets, equipment)` | модель/инвентарный признак, общие слова («принтер») не считаются |
| `quickOutcomes(category)` | три формулировки на категорию; неизвестная категория → пусто |
| `appendOutcome(text, outcome)` | точка и пробел, без дублей |
| `stepsToChecked(steps)` / `stepKey(articleId, index)` | отметки с сервера → карта чек-листа |
| `stepProgress` / `stepCounterLabel` | «выполнено 2 из 5», прогресс статьи |
| `deadlineInputToIso` / `reasonReady` | `datetime-local` → ISO, причина ≥ 3 символов |

## Решения и ограничения

- **Не выдумываем данные:** «помогла N из M», время решения похожих заявок и счётчик «7 заявок за месяц»
  из макета не показываются — API их не отдаёт. Предупреждение о частой поломке строится только на
  фактической выдаче `tickets` (`> 1` совпадение по модели).
- Отметки шагов чек-листа на карточке задачи хранятся у заявки (`ticket_article_step`): галочка уходит
  в `POST /api/m/knowledge/tickets/:id/steps` и переживает перезагрузку; счётчик — «выполнено N из M».
  В статье на вкладке «База знаний» заявки нет, поэтому отметки там живут только в интерфейсе.
- Вопрос базе знаний на вкладке «База знаний»: агент `engineer-assistant` отвечает только по найденным
  статьям; ответ помечен «Агент с инструментами» или «Шаблон по статьям», каждая ссылка открывает статью
  через `GET /api/m/knowledge/articles/:id`. Без статей сервер отвечает 422 — интерфейс показывает ошибку
  с повтором.
- Продление срока у инженера вернёт 403 (`tickets.edit`); ошибка показывается с повтором.
- Причина возврата в `TransitionInput` не описана — интерфейс отправляет `reason`, контракт его
  отбрасывает (❓ нужен `reason` в схеме).
- Сохранение статьи из результата и слот `engineer-desk.resolution` — вместе с модулем `knowledge`.
- `PriorityBars` — индикатор без слова: приоритет словами в списках запрещён дизайном (3.4).

## Как проверить

```bash
npx vitest run modules/engineer-desk
npx tsc --noEmit
npx vite build --config apps/web/vite.config.ts
```

Регистрация: одна строка в `modules/registry.web.ts` (`engineerDeskWeb`), добавляется оркестратором.
