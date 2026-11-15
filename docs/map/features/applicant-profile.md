# Карта фичи: профиль заявителя и «гость» (025)

Статус: active
Дата: 2026-11-14
Связано: [../README.md](../README.md), [../../specs/case9-features.md](../../specs/case9-features.md#32-профиль-заявителя-и-гость), [../../history/2026-11.md](../../history/2026-11.md)

Профиль заявителя — подсказка, а не источник истины: шаг подставляет место и однозначную технику
в пустые поля, а всё, что человек написал в обращении, остаётся главнее. Гость `guest` профиля не имеет,
поэтому ему всё задаётся вопросами в чате.

## Файлы

| Файл | Что там |
| --- | --- |
| `modules/applicant-profile/server/prefill.ts` | чистая логика шага: пустые поля места, тип техники по тексту, поиск единственной единицы в CMDB |
| `modules/applicant-profile/server/index.ts` | `defineModule`: шаг `profile.prefill` (`validate`, `order 150`, `reads/writes: ['fields']`), отчёт в прогресс |
| `modules/applicant-profile/tests/profile.test.ts` | пустые/заполненные поля, гость, нет профиля, техника одна/несколько, след `from_profile`, прогресс |
| `modules/applicant-profile/tests/contract.test.ts` | `assertModuleContract` и `runModuleContract` |
| `packages/core/src/storage.ts` | `ApplicantProfile`, `ApplicantEquipment`, методы `KernelStore` и реализация в `MemoryStore` |
| `packages/db/src/schema.ts` | Drizzle-схема `applicant_profile`, `applicant_equipment` |
| `packages/db/src/pg-store.ts`, `mappers.ts` | реализация `KernelStore` на PostgreSQL и мапперы строк |
| `packages/db/migrations/0005_applicant_profile.sql` | идемпотентные таблицы и индекс по `applicant_equipment.user_id` |
| `packages/db/src/seed/index.ts` | сид профилей из `data/users.json` (`profile`), идемпотентно |
| `packages/core/tests/profile-store.test.ts` | `MemoryStore`: сохранение/чтение профиля, пусто, список техники |

## Как работает шаг

1. Нет `ctx.user` или `ctx.db` → `{}`; нет профиля пользователя (гость) → `{}`.
2. Для `building`, `floor`, `cabinet`: если поле пустое — значение из профиля, `origin: 'profile'`,
   `confidence: 0.8`, `quote: null`, след `from_profile` шага `profile.prefill`. Заполненное поле не трогаем.
3. Тип техники из текста обращения: принтер → `printer`, ПК/компьютер/ноутбук → `pc`, МФУ → `mfu`,
   свитч/коммутатор → `network`, сервер → `server`.
4. `ports.cmdb.findEquipment({ building, cabinet })` по месту **после** слияния с профилем; тип фильтруется кодом.
   Ровно одна единица → `equipment` и `model` = модель, `inventoryNo`, `ip` (только пустые поля).
   Несколько единиц — не угадываем; CMDB недоступна — подставляем только место, шаг не падает.
5. Каждое подставленное поле сообщается через `ctx.progress` с `fields: [key]` и подписью «— из профиля».

## Данные

- `applicant_profile`: `user_id` (PK), `building`, `floor`, `cabinet`, `equipment_id`, `updated_at`.
- `applicant_equipment`: `id` (PK), `user_id`, `equipment_id`, `note` — техника заявителя для экрана «Мой профиль».
- Источник сида — поле `profile` в `data/users.json` (`UserProfileSeed` в `packages/db/src/seed/load-data.ts`).
  У `guest` и служебных ролей профиля нет — сид их пропускает.

## Точки входа

| Что | Где |
| --- | --- |
| Шаг `profile.prefill` | `modules/applicant-profile/server/index.ts` |
| Логика подстановки | `modules/applicant-profile/server/prefill.ts` (`prefillFromProfile`, `equipmentTypeInText`) |
| Хранилище профиля | `KernelStore.getApplicantProfile` / `saveApplicantProfile` / `listApplicantEquipment` |
| Флаг фичи | `enabledByDefault: true`, выключение — `FEATURES_OFF=applicant-profile` |

## Проверки

```bash
npx vitest run modules/applicant-profile packages/core
```

- пустые поля заполняются, заполненные — нет; текст обращения главнее профиля (в том числе по месту для CMDB);
- гость и пользователь без профиля → `{}`;
- одна единица техники подставлена, несколько — нет; недоступная CMDB не роняет шаг;
- у каждого поля след `from_profile`, `origin: 'profile'`, уверенность 0,8 и нет цитаты;
- `assertModuleContract` проходит, `runModuleContract` без пользователя даёт пустые поля.

## Особенности

- Шаг стоит после `extraction.ground` внутри стадии `validate`, поэтому читает уже проверенные цитаты.
- Модуль не импортирует `extraction` и не пишет в чужие ключи черновика: только `fields`.
- Ядро требует, чтобы id шага начинался с id модуля (`applicant-profile.`), а спецификация называет шаг
  `profile.prefill`. В тест-контракте id шага подменяется на `applicant-profile.profile-prefill`;
  `run`, `reads`, `writes` при этом настоящие. Правильное лечение — отдельный namespace шагов в `packages/testkit`.
- Экран «Мой профиль» — COULD: `listApplicantEquipment` уже готов, маршрут и страница — отдельной задачей.

## Правка места и техники, сотрудники руководителя (2026-11-14)

| Что | Где |
|---|---|
| `GET /api/profile/options` — корпуса и техника CMDB для форм | `apps/api/src/people-routes.ts` |
| `PATCH /api/profile/place` `{ building, cabinet }` — этаж из первой цифры кабинета | там же |
| `POST /api/profile/equipment` `{ equipmentId }`, `POST /api/profile/equipment/:id/remove` — первая техника становится основной | там же |
| `POST /api/users`, `PATCH /api/users/:id/role` — право `settings` (руководитель), свою роль менять нельзя | там же |
| Экран профиля: карточки с формами | `apps/web/src/screens/ProfilePage.tsx`, `profile-format.ts` (`equipmentChoices`) |
| Вкладка «Сотрудники» (`/team`) | `apps/web/src/screens/TeamPage.tsx`, `team-format.ts`, `team.css` |
| Хранилище: `saveApplicantEquipment`, `deleteApplicantEquipment` | `packages/core/src/storage.ts`, `packages/db/src/pg-store.ts` |
