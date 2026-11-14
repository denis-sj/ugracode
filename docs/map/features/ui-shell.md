# Карта фичи: дизайн-система и оболочка

Статус: active
Дата: 2026-11-14
Связано: [../README.md](../README.md), [../../specs/case9-core.md](../../specs/case9-core.md), [../../specs/case9-features.md](../../specs/case9-features.md), [../../tasks/007-ui-shell-chat-card.md](../../tasks/007-ui-shell-chat-card.md), [dispatcher-review-ui.md](dispatcher-review-ui.md)

Общая оболочка веб-приложения и дизайн-система. Экран заявителя — `modules/clarify-chat/web`,
очередь диспетчера — [dispatcher-review-ui.md](dispatcher-review-ui.md).

## Что сделано

| Где | Что |
|---|---|
| `packages/ui/src/tokens.css` | цвета, отступы, радиусы, тени, типографика, длительности и кривые анимаций; тёмная тема по умолчанию, светлая — класс `.theme-light` |
| `packages/ui/src/styles.css` | базовые стили и классы компонентов; все цвета — через `var(--…)`, своих цветов нет |
| `packages/ui/src/components/` | `Card`, `Badge`, `Button`, `ConfidenceBar`, `QuoteChip`, `FieldRow`, `StatTile`, `Timeline`, `OriginBadge`, `MicButton`, `Slot` |
| `packages/ui/src/animations.ts` | `flyToField` (перелёт цитаты в поле), `pulse`, `countUp`; длительности читаются из токенов |
| `packages/ui/src/useActionCounter.ts` | счётчик действий для К4: клик, ввод, выбор, переход, системное действие |
| `apps/web/src/screens/LoginScreen.tsx` | вход выбором готового пользователя, карточки по ролям, «Войти как гость» |
| `apps/web/src/shell/AppShell.tsx` | шапка, меню по роли, счётчик действий, слоты виджетов, hash-роутинг без React Router |
| `apps/web/src/screens/HomeScreen.tsx` | стартовый экран: показатели, маршруты по роли, схема разбора, включённые модули |
| `apps/web/src/screens/ApiDownScreen.tsx` | экран «API не отвечает» и заставка загрузки |
| `apps/web/src/api.ts` | клиент API с cookie-сессией; `ApiError` с кодом ответа |
| `apps/web/src/session.tsx` | состояние пользователя в контексте (`SessionProvider`, `useSession`) |
| `apps/web/src/router.ts` | `useHashRoute`, `normalizePath` |
| `apps/web/src/lib.ts` | чистые функции: меню, разделы, группировка пользователей, инициалы, приветствие |

Индикатора контура ИИ («облако / локально») в шапке нет — решение е9 в
[case9-features.md](../../specs/case9-features.md). Интерфейс не зависит от `AI_MODE`: режим влияет только на сервер.

## Токены и стиль

- Единственный источник цветов и анимаций — `packages/ui/src/tokens.css`.
  Модулям запрещены свои цвета и «сырые» значения длительностей.
- Подключение: `apps/web/src/main.tsx` импортирует `@ugra/ui/tokens.css` и `@ugra/ui/styles.css`;
  псевдонимы заданы в `apps/web/vite.config.ts`, пути — в корневом `tsconfig.json`.
- Тема: `:root` и `.theme-dark` — тёмная (по умолчанию), `.theme-light` — светлая.
- Семантика цветов: `--color-ok`, `--color-warn`, `--color-danger`, `--color-info`,
  приоритеты `--color-priority-emergency|critical|high|medium|low`.
- Длительности: `--dur-fast`, `--dur-base`, `--dur-slow`, `--dur-ambient`; кривые `--ease-out`, `--ease-spring`.
  В `animations.ts` те же значения читаются из CSS-переменных (`tokenDuration`).
- `prefers-reduced-motion` отключает анимации — правило в `styles.css`.

## Слоты виджетов

Оболочка рисует виджеты из реестра `modules/registry.web.ts`; выключенный модуль не попадает в слот.

| Слот | Кто рисует | Назначение |
|---|---|---|
| `shell.topbar` | оболочка | значки и быстрые действия в шапке |
| `dashboard.tiles` | `HomeScreen` | плитки показателей на стартовом экране |
| `dashboard.main` | `HomeScreen` | основной блок дашборда |
| `ticket.banner`, `ticket.main`, `ticket.side`, `ticket.footer` | зарезервированы под задачу 010 | карточка заявки |
| `queue.toolbar` | зарезервирован | панель фильтров очереди |
| `applicant.chat.footer` | зарезервирован под задачу 009 | кнопки чата (скриншот, голос) |

`Slot` фильтрует виджеты по имени слота и роли, сортирует по `order` и рисует компонент.
Виджет без компонента пропускается — страница не падает.

## Маршруты и роли

- Роутинг — hash (`#/chat`, `#/queue`), без React Router. Неизвестный путь уводит на первую страницу роли.
- Меню строится из страниц веб-модулей: `buildMenu` → `filterMenuByRole` → `groupMenuBySection`.
- Страницы выключенных модулей не показываются: список включённых берётся из `GET /api/meta`.
  Пока серверные части модулей не влиты и в мете нет ни одного модуля со страницами,
  `resolveMenuModuleIds` показывает зарегистрированные веб-страницы — иначе чекпоинт 1 не показать.
  Как только сервер знает хотя бы один такой модуль, правило строгое и `FEATURES_OFF` убирает пункт меню.
- `GET /api/meta` также даёт реестр полей и справочники — из них строятся формы и вопросы.
- Сессия: `GET /api/session` при старте, `POST /api/session { userId }` при входе; cookie ставит сервер.

## Как запустить

```bash
pnpm dev:api     # API на http://localhost:3001
pnpm dev:web     # веб на http://localhost:5173
```

1. Выбрать пользователя (или «Войти как гость»).
2. Заявитель → `#/chat`; диспетчер → `#/queue`.
3. Если API не запущен, показывается экран «API не отвечает» с кнопкой обновления.

## Проверки

```bash
npx tsc --noEmit
npx vitest run apps/web
npx vite build --config apps/web/vite.config.ts
```

- `apps/web/tests/lib.test.ts` — меню, роли, разделы, группировка пользователей, пути.
- `apps/web/tests/meta.test.ts` — сводка `/api/meta`.
- `packages/ui/tests/format.test.ts` — уверенность, тона, счётчик действий.
- Сборка кладёт результат в каталог `dist` рядом с `apps/web` (в репозиторий не коммитится).
