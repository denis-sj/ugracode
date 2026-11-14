# 033. Перерисовать экраны по макетам

Статус: todo (ждёт 032)
Дата: 2026-11-14
Роль: Семён
Исполнитель: —
Ветка: feature/ui-screens-redesign
PR: —
Связано: [../specs/case9-ui-design.md](../specs/case9-ui-design.md), [../specs/ui-mockups/](../specs/ui-mockups/), [032-ui-design-foundation.md](032-ui-design-foundation.md), [README.md](README.md#скиллы-superpowers-для-семёна)

Каждый экран — по своему макету и разделу 4 спецификации, на компонентах из задачи 032. Данные — из API,
не из макета. Работать по одному экрану за PR, в папке модуля этого экрана; общие файлы не трогать.
Если модуля или маршрута API ещё нет — экран на моковых данных с пометкой `❓ сверить с контрактом`
и строка владельцу, не выдумывать API.

## Экраны и порядок (сверху — важнее для защиты)

| # | Экран | Макет | Где в коде | Связанная задача |
|---|---|---|---|---|
| 1 | Обращение: чат, карточки-вопросы, стикер заявки | `Chat.dc.html` | `modules/clarify-chat/web/` | 009 |
| 2 | Очередь | `Queue.dc.html` | `modules/dispatcher-review/web/` | 010 |
| 3 | Проверка заявки по шагам | `Review.dc.html` | `modules/dispatcher-review/web/` | 010 |
| 4 | Авария и массовость | `Incident.dc.html` | `modules/emergency/web/`, массовость — модуль 016 | 011, 016 |
| 5 | Голос и фото | `Voice.dc.html` | `modules/clarify-chat/web/` (`useVoiceInput`) | 019, 026 |
| 6 | Дашборд и отчёт | `Dashboard.dc.html` | `modules/reports-dashboard/web/` | 015, 021 |
| 7 | Качество ИИ (К2) | `Quality.dc.html` | `modules/quality/web/` | 014 |
| 8 | С ИИ / без ИИ (К4) | `Compare.dc.html` | модуль задачи 017 | 017 |
| 9 | Инженер: задача | `Engineer.dc.html` | модуль задачи 018 | 018 |
| 10 | Мои заявки | `Cabinet.dc.html` | `modules/clarify-chat/web/TicketsPage.tsx` | 009 |
| 11 | Профиль | `Profile.dc.html` | `modules/applicant-profile/` | 025 |
| 12 | Журнал действий | `Log.dc.html` | `modules/dispatcher-review/web/` | 010 |
| 13 | Исполнители | `People.dc.html` | модуль маршрутизации (`modules/routing/`) | — |
| 14 | База знаний | `KB.dc.html` | `modules/knowledge/` | 029 |

## Критерии готовности (для каждого экрана)

- Совпадает с макетом по раскладке, текстам и взаимодействиям из раздела 4 спецификации; запреты раздела 1 соблюдены.
- Уверенность — в процентах, приоритет — круг-доля, происхождение поля подписано.
- **Работает в демо-сценарии** брифа (раздел 9) на реальных данных API.
- Тесты на чистые функции экрана; карта фичи в `docs/map/features/` обновлена.
- `pnpm check` зелёный; нет новых замечаний SonarQube уровня Blocker / Critical / Major.

## Блокеры

Задача 032.
