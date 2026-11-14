# Карта фичи: замер «с ИИ / без ИИ» (017, К4)

Статус: active
Дата: 2026-11-14
Связано: [../README.md](../README.md), [../../specs/case9-core.md](../../specs/case9-core.md),
[../../specs/case9-features.md](../../specs/case9-features.md), [../../specs/case9-ui-design.md](../../specs/case9-ui-design.md),
[../../hackathon/case9-brief.md](../../hackathon/case9-brief.md), [../../hackathon/demo-script.md](../../hackathon/demo-script.md)

Финал демо: одна и та же заявка дважды — пустая форма руками и готовая карточка ИИ. Действия и время
считает интерфейс (`useActionCounter` + таймер), а не человек на глаз. Модуль `ai-vs-manual`,
страница `/measure` (роли `dispatcher`, `admin`).

## Файлы

| Где | Что |
|---|---|
| `modules/ai-vs-manual/web/index.ts` | страница `/measure`; нужна строка в `modules/registry.web.ts` |
| `modules/ai-vs-manual/web/MeasurePage.tsx` | две колонки, старт/финиш замера, живой счётчик, сохранение, сброс, экспорт JSON, `?demo=1` |
| `modules/ai-vs-manual/web/ManualForm.tsx` | ручная форма из реестра полей: без подсказок, уверенности и цитат |
| `modules/ai-vs-manual/web/AiCard.tsx` | карточка ИИ: та же заявка, `FieldRow` с `ConfidenceBar` и `QuoteChip` |
| `modules/ai-vs-manual/web/SummaryPanel.tsx` | итог «N против M действий, X против Y секунд», проценты, определение действия |
| `modules/ai-vs-manual/web/format.ts` | чистые функции: `summarizeSessions`, `tally`, `savingsPercent`, `speedup`, `formatSeconds`, разбор сессий, поля |
| `modules/ai-vs-manual/web/storage.ts` | `localStorage` (битые данные не ломают экран), экспорт JSON для слайда |
| `modules/ai-vs-manual/web/measure.css` | стили только на токенах `@ugra/ui` |
| `modules/ai-vs-manual/server/index.ts` | пустая серверная часть: только id, title и `enabledByDefault: true` |
| `modules/ai-vs-manual/tests/format.test.ts` | успех, пусто, битые данные, справочники, лимит полей |
| `modules/ai-vs-manual/tests/contract.test.ts` | тест-контракт модуля |

## Как считается замер

- **Ручное действие** (одно и то же на экране, в экспорте и в отчёте): клик, ввод символа в поле,
  выбор из списка, переход по полю и поиск в справочнике или CMDB. Считает `useActionCounter`
  из `packages/ui` — слушатели на документе, плюс явные `trackAction('navigate' | 'system')`.
- **Время** — от клика «Начать замер» до «Готово»; таймер `useElapsed`, в сессию пишется секунды.
- **Финальный клик по «Готово»** документный слушатель ещё не успевает положить в состояние,
  поэтому при записи сессии он добавляется вручную (`actions.count + 1`).
- Старт замера сбрасывает счётчик: клик по «Начать» в цифры не попадает.
- Одновременно идёт только один замер; вторая колонка на это время заблокирована.

## Данные

- Ручная форма — `pickMeasureFields(meta.fields)`: обязательные первыми, не больше семи полей,
  без `extractHint`, уверенности и цитат; справочники — `select` из `meta.dictionaries`.
- Карточка ИИ — первая заявка из `GET /api/tickets?limit=1` (или `?ticket=<id>`), поля из
  `GET /api/tickets/:id`; `aiFieldRows` переводит коды справочников в подписи.
- Сессии — `localStorage`, ключ `ugra.ai-vs-manual.sessions.v1`, не больше 50 записей.
  **Серверной таблицы нет — ❓ завести таблицу модуля, когда замеры понадобятся отчёту.**
- `?demo=1` — предзаполненные цифры (47 действий / 3 мин 34 с против 6 / 38 с) с пометкой
  «демо-данные»; в экспорте у них `demo: true`, чтобы не выдать показ за настоящий замер.

## Итог и экспорт

`summarizeSessions` усредняет сессии каждого режима и считает: разницу действий и секунд,
процент экономии (отрицательный, если ИИ оказался дороже — без прикрас) и «во сколько раз быстрее».
Кнопка «Экспорт JSON» отдаёт файл `ai-vs-manual-ГГГГ-ММ-ДД.json`: итог, сессии, определение действия.
«Сбросить» чистит `localStorage` и экран.

## Проверки

- `npx vitest run modules/ai-vs-manual` — 28 тестов: успех, пустые данные, битый JSON, отрицательные
  и нечисловые значения, усреднение, проценты, справочники, лимит полей.
- `npx tsc --noEmit`, `npx eslint modules/ai-vs-manual`, `npx vite build --config apps/web/vite.config.ts`.
- Ручная проверка в браузере: `#/measure`, `#/measure?demo=1`, пройти замер вручную и с ИИ,
  обновить страницу — сессии на месте, экспорт скачивается.

## Регистрация (чужая зона — отдано владельцу)

```ts
// modules/registry.web.ts
import aiVsManualWeb from './ai-vs-manual/web';
// в webModules и в export, по алфавиту первым
```

```ts
// apps/web/src/shell/lib.ts — вкладка для dispatcher и admin
{ path: '/measure', label: 'С ИИ / без ИИ', icon: 'reports' },
```

## Особенности

- Модуль не импортирует `dispatcher-review`: карточка ИИ — упрощённая копия полей на `FieldRow`,
  чтобы не тянуть чужую веб-часть (модули не импортируют друг друга).
- В экспорте и на экране одинаковое определение ручного действия — сравнение честное.
- Серверная часть пустая намеренно: флаг `FEATURES_OFF=ai-vs-manual` работает, данных на сервере нет.
