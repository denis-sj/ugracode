# Карта фичи: разбор обращения — извлечение полей (006)

Статус: active
Дата: 2026-11-14
Связано: [../README.md](../README.md), [../../specs/case9-agent-harness.md](../../specs/case9-agent-harness.md), [../../specs/case9-core.md](../../specs/case9-core.md#51-контракт-ответа-модели-шаг-извлечения), [../../specs/case9-features.md](../../specs/case9-features.md), [../../history/2026-11.md](../../history/2026-11.md)

Агент `intake` разбирает обращение инструментами, затем код проверяет каждый факт. Поля без цитаты
или вне справочника в заявку не попадают: «агент предлагает — код проверяет — человек подтверждает».

## Файлы

| Файл                                      | Что там                                                                                                                         |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `modules/extraction/contracts.ts`         | zod-схемы результата агента (`IntakeResult`) и данных модуля в черновике (`ExtractionExtras`)                                   |
| `modules/extraction/server/intake.ts`     | профиль агента `intake`: промпт, инструменты, `submit`, `state()`, `check()`, преобразование полей в `FieldValue`               |
| `modules/extraction/server/rules.ts`      | проверки кодом: цитата в тексте, значение из справочника, `pattern`, поиск источника цитаты                                     |
| `modules/extraction/server/ground.ts`     | шаг `extraction.ground`: повторные проверки, порог уверенности, сверка с CMDB, инвентарный номер/IP, `equipmentId`/`locationId` |
| `modules/extraction/server/evaluate.ts`   | точность по полям эталона (`evalMode`), метрики для оценщика 014                                                                |
| `modules/extraction/server/index.ts`      | `defineModule`: шаги `agent.intake` и `extraction.ground`, регистрация агента                                                   |
| `modules/extraction/prompts/intake.v2.md` | промпт агента: роль, реестр полей, правило цитаты, CMDB, авария, вопрос заявителю                                               |
| `modules/extraction/tests/`               | успешный сценарий, выдуманная цитата, значение вне справочника, CMDB, порог, `evaluate`, тест-контракт                          |

## Как работает

1. `agent.intake` (стадия `extract`, `order 100`) собирает текст из `draft.sources` и запускает
   `runAgent()`: до 6 шагов, инструменты только `dictionary_lookup`, `cmdb_find_equipment`,
   `cmdb_list_locations`. В состоянии — реестр полей, справочники, время и канал обращения.
2. Итог агента — только `submit` (схема `IntakeResult`): поля с цитатой и уверенностью, признаки аварии,
   вопрос заявителю, краткое резюме. Свободный текст вместо `submit` — ошибка.
3. `check()` возвращает ошибки модели: поля вне реестра, отсутствующая или выдуманная цитата, значение
   не из справочника, `pattern`, вариант вопроса не из справочника, цитата признака аварии. Модель
   исправляется и вызывает `submit` снова.
4. Поля превращаются в `FieldValue`: `origin: 'text'`, цитата `{ sourceId, text }`, след `found`
   или `rejected`. Резюме, вопрос и мнение об аварии — в `draft.ext.extraction`.
5. `extraction.ground` (стадия `validate`, `order 100`) повторяет проверки кодом: цитата не в тексте →
   значение `null` и след `rejected`; значение вне справочника или `pattern` → `null`; уверенность ниже
   `confidenceThreshold` (0,75) → `needsReview`.
6. Сверка с CMDB по корпусу, кабинету, модели и типу: одно совпадение → инвентарный номер и IP
   (`origin: 'cmdb'`), `equipmentId`, `locationId`, `criticality` в `draft.ext.extraction.cmdb`;
   несколько → `needsReview` и пометка «выбирает диспетчер»; ничего → без изменений.
7. `evaluate()` сравнивает поля с `expected.fields` по режиму `evalMode` и возвращает `Metric[]`
   (метрика на поле + `fields_accuracy`).

## Точки входа

| Что                                                                                 | Где                                                                       |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Агент `intake` (`promptId: modules/extraction/prompts/intake.v2.md`, `maxSteps: 6`) | `modules/extraction/server/intake.ts`                                     |
| Шаг `agent.intake` (`reads: sources`, `writes: fields, ext`)                        | `modules/extraction/server/index.ts`                                      |
| Шаг `extraction.ground` (`reads: fields`, `writes: fields, ext`)                    | `modules/extraction/server/index.ts`, логика в `ground.ts`                |
| Данные модуля `draft.ext.extraction`                                                | `contracts.ts` (`ExtractionExtras`), читаются другими модулями как данные |
| Метрики `field_<ключ>` и `fields_accuracy`                                          | `evaluate()` шага `agent.intake`                                          |

## Проверки

```bash
npx vitest run modules/extraction
```

- сценарий `ScenarioTurn[]` (инструмент CMDB → `submit`) даёт поля с цитатами и источником;
- выдуманная цитата и значение вне справочника возвращаются модели; после исправления `submit` проходит;
- несколько совпадений в CMDB → `needsReview`; низкая уверенность → `needsReview`;
- `ground` добавляет `INV-000312`, IP `10.10.3.12`, `equipmentId` и `locationId` для примера заказчика;
- `evaluate` считает попадания и долю; без эталона — пусто;
- тест-контракт и сквозной прогон с выключенным модулем (без модели шаг «не выполнен», демо не падает).

## Особенности

- Шаг называется `agent.intake` по спецификации харнесса; тест-контракт требует префикс id модуля,
  поэтому в контрактном тесте меняется только id шага.
- `evaluate()` не получает `ctx.data`, поэтому режим сравнения задан списком точных ключей; базовую
  сверку по реестру делает модуль `quality`.
- Кэша, повторов и запасного пути нет: ошибка модели — шаг «не выполнен», заявка уходит диспетчеру.

## Промпт v2 и контекст заявителя (2026-11-14, ветка `feature/smart-clarify`)

- Промпт `intake.v2.md`: вместо одного `clarify` модель сдаёт `questions` — до 4 вопросов по важности (одно поле —
  один вопрос), словами заявителя и с вариантами из справочника или техники кабинета. Правила «плохо / хорошо»
  — в разделе «Вопросы заявителю». Старый `clarify` схема ещё принимает (`intakeQuestions` в `contracts.ts`).
- Состояние агента: `applicant` (`applicantState` в `server/intake.ts`) — ФИО, должность, рабочее место из профиля
  и техника кабинета из CMDB (`main: true` — основной ПК). Нет профиля или CMDB — разбор не падает.
- Проверка `check()`: вопрос по полю вне реестра, по полю, уже заполненному из текста, и вариант вне справочника —
  ошибки, модель исправляет `submit`.
- `draft.ext.extraction`: `questions` (весь план) и `clarify` (первый вопрос, для старых читателей).
