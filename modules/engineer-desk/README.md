# Модуль `engineer-desk` — рабочее место инженера (4.6)

Веб-часть: страница `/tasks` для ролей `engineer` и `admin`. Серверных маршрутов у модуля нет —
он работает на API ядра и модуля `knowledge`. Карта — [engineer-desk.md](../../docs/map/features/engineer-desk.md),
дизайн — [case9-ui-design.md](../../docs/specs/case9-ui-design.md#46-инженер), макет — `Engineer.dc.html`.

## Что на экране

- **Слева задачи на сегодня:** `GET /api/tickets?assigneeId=<id>&limit=200`, только `assigned`/`in_progress`,
  сортировка «ближайший срок → приоритет». Приоритет — индикатор `PriorityBars`, срок — `formatDue`;
  «Взять в работу» в строке и в карточке → `POST /api/tickets/:id/transition` `{ to: 'in_progress' }`.
- **По центру задача:** номер, заголовок из симптомов, место и оборудование из полей, заявитель,
  статус, сроки реакции и решения по регламенту и «осталось N ч N мин» (`reactDueAt`, `slaDueAt`).
- **Диагностика:** `GET /api/m/knowledge/search?q=<симптомы + объект + оборудование + модель + код ошибки>`.
  Статью выбирает `pickArticle` по совпадению слов; шаги — чек-листом, отметки живут только в браузере.
  «Помогла N из M» **не показываем**: API такой статистики не отдаёт.
- **Похожие решённые:** `tickets` из того же ответа (кроме самой заявки). Предупреждение «частая поломка
  устройства» — только если `> 1` заявка совпала по модели/инвентарному признаку (`recurringEquipmentCount`).
- **Результат:** быстрые формулировки по категории, поле «что сделано» → `POST /api/tickets/:id/resolution`
  `{ text }`; «Продлить срок» → диалог с обязательной причиной → `POST /api/tickets/:id/deadline`;
  «Вернуть диспетчеру» → диалог с причиной → `POST /api/tickets/:id/transition` `{ to: 'in_review' }`.
- **Вкладка «База знаний»:** тот же поиск с паузой в вода, список статей, статья с симптомами, решением
  и шагами чек-листом.
- **Пустые состояния и ошибки:** у списка, диагностики, похожих и базы знаний — свой текст и кнопка
  «Повторить» (повторный запрос).

## Файлы

| Файл | Что там |
|---|---|
| `web/index.ts` | `defineWebModule`: страница `/tasks`, роли `engineer`, `admin` |
| `web/EngineerDeskPage.tsx` | экран: список, карточка, диагностика, результат, база знаний, диалоги |
| `web/format.ts` | чистые функции: `myTasks`, `sortMyTasks`, `dueState`, `knowledgeQuery`, `pickArticle`, `recurringEquipmentCount`, `quickOutcomes`, `statusActions`, `appendOutcome` |
| `web/engineer-desk.css` | стили только на токенах `@ugra/ui`, светлая тема |
| `tests/format.test.ts` | 33 теста чистых функций (задачи, сроки, статьи, поломки, диалоги) |

## Чего API не умеет (❓)

- **Продление срока инженеру недоступно:** `POST /api/tickets/:id/deadline` требует право `tickets.edit`,
  а у роли `engineer` его нет — интерфейс показывает ошибку API как есть. Нужно либо право, либо
  отдельный маршрут для исполнителя.
- **Причина возврата не сохраняется:** `TransitionInput` принимает только `{ to }`. Интерфейс отправляет
  `reason`, но zod-схема его отбрасывает; для журнала нужно добавить `reason` в контракт.
- **«Сохранить как статью базы знаний»** не реализовано: маршрута сохранения статьи нет, слот
  `engineer-desk.resolution` объявляется вместе с модулем `knowledge` (задача 018).
- **Статистика «помогла N из M»** и время решения похожих заявок в API отсутствуют — не выдумываем.
- Диктовка результата (`MicButton`) и карточка «Проблема решена?» — следующие шаги задачи 018.

## Проверки

```bash
npx tsc --noEmit
npx vitest run modules/engineer-desk
npx eslint modules/engineer-desk
npx vite build --config apps/web/vite.config.ts
```

## Регистрация

`modules/registry.web.ts`: `import engineerDeskWeb from './engineer-desk/web';` и `engineerDeskWeb`
в `webModules` (по алфавиту — после `emergencyWeb`). Строку добавляет владелец/оркестратор.
