# Карта фичи: уточнения в чате (009)

Статус: active
Дата: 2026-11-14
Роль: Семён
Связано: [../README.md](../README.md), [../../specs/case9-core.md](../../specs/case9-core.md#53-ключевые-алгоритмы), [../../specs/case9-features.md](../../specs/case9-features.md#31-чат-с-вопросами-по-смыслу-а1-а2-а3), [clarify-chat-ui.md](clarify-chat-ui.md), [extraction.md](extraction.md)

Серверная часть модуля `clarify-chat`: недостающие обязательные поля считает код, вопрос задаётся
одной карточкой за раз, ответ заявителя попадает в поле заявки и запускает повторный разбор.
Клиент уже умеет показывать карточки; история чата теперь хранится на сервере.

## Файлы

| Файл | Что там |
| --- | --- |
| `modules/clarify-chat/server/index.ts` | `defineModule`: id `clarify-chat`, `enabledByDefault: true`, шаг `clarify.missing`, `seed()` — no-op |
| `modules/clarify-chat/server/clarify.ts` | шаг: недостающие поля по реестру (черновик + сохранённые поля заявки), круги по полю, сообщение `question_card`, событие `message.sent`, статус `waiting_applicant` |
| `modules/clarify-chat/server/question.ts` | план вопросов модели (`draft.ext.extraction.questions`, старый `clarify`; после ответа — `plan` из первой карточки), порядок по плану (`orderByPlan`), шаблон `FieldDef.ask` — только запасной; варианты справочника — только его коды; карточка с `plan` |
| `modules/clarify-chat/README.md` | пять строк: что делает, правила, точки расширения, флаг, момент демо |
| `modules/clarify-chat/tests/clarify.test.ts` | шаг: есть/нет missing, лимит кругов, «Не знаю», нет `db`, вопрос модели |
| `modules/clarify-chat/tests/plan.test.ts` | план вопросов: чтение из разбора и истории, порядок, `plan` в карточке |
| `modules/clarify-chat/tests/contract.test.ts` | тест-контракт модуля |
| `modules/registry.server.ts` | **одна строка регистрации — не добавлена** (файл чужой для задачи), см. «Не поддержано» |
| `packages/contracts/src/api.ts` | `PostAppealMessageInput`, `AppealMessagesResponse`, `PostAppealMessageResponse` |
| `packages/core/src/storage.ts` | `KernelStore.saveAppealMessage`, `KernelStore.listAppealMessages` + `MemoryStore` |
| `packages/db/src/schema.ts`, `mappers.ts`, `pg-store.ts` | таблица `appeal_message`, колонка `card`, маппер, методы на PostgreSQL |
| `packages/db/migrations/0007_appeal_messages.sql` | `card jsonb` + индекс `(appeal_id, created_at)`, идемпотентно |
| `apps/api/src/server.ts` | `GET|POST /api/appeals/:id/messages`, след ответа, рерун с `validate` |
| `apps/api/tests/clarify-chat.test.ts` | вопрос создаётся и сохраняется, ответ заполняет поле и перезапускает разбор, «Не знаю», чужой → 403, флаг модуля |

## Как считаем и спрашиваем

1. Шаг `clarify.missing` (стадия `validate`, `order 200`, `reads: ['fields','missing']`,
   `writes: ['missing','ext']`) пересчитывает недостающие обязательные поля кодом
   (`missingFields` из `@ugra/core`) по реестру `ctx.data.fields`.
   Вход — черновик **и уже сохранённые поля заявки**: повторный разбор с `validate` начинается
   с пустого черновика, а отвеченные поля терять нельзя.
2. Поля, на которые ответили «Не знаю» (след `no_answer`), больше не спрашиваем.
3. Недостающие поля сортируем **по плану модели** (что важнее для заявки), поля вне плана — в конце по реестру.
   План — `draft.ext.extraction.questions`; на повторном разборе после ответа его нет в черновике, поэтому
   план хранится в `card.payload.plan` первой карточки и читается из истории чата.
   Берём первое поле, у которого:
   - вопросов в истории меньше `maxClarifyRounds` (настройка, по умолчанию 2);
   - нет ожидающего ответа (последнее сообщение по полю — `question_card`).
4. Текст вопроса: `draft.ext.extraction.clarify`, если модель предложила вопрос по этому же полю,
   иначе шаблон `FieldDef.ask`. `source: 'ai' | 'template'`, `allowUnknown: true`, `allowFreeText: true`.
5. Варианты: справочник → только его значения (`validated: true`), предложения модели вне справочника
   отбрасываются; свободное поле → варианты модели как есть (`validated: false`).
6. Сохраняем сообщение `question_card` (`direction: 'out'`, `fieldKey`, `card.cardType = 'question'`),
   публикуем `message.sent`, переводим заявку в `waiting_applicant`.
7. Нечего спрашивать — шаг ничего не меняет (список `missing` отдаёт `finalize`).

## Ответ заявителя

`POST /api/appeals/:id/messages` (право `appeal.answer`; автор или диспетчер):

| Шаг | Что происходит |
| --- | --- |
| 1 | Сообщение сохраняется (`direction: 'in'`, `kind`, `body`, `fieldKey`), событие `message.sent` |
| 2 | Для `kind: 'answer'` с `fieldKey` поле пишется с `origin: 'asked'`, `confidence: 1`, след `asked` → `answered`; событие `ticket.field.set` |
| 3 | `engine.rerun(appeal, 'validate')` + `tickets.applyAnalysis` — пересчёт остальных полей |
| 4 | Поля заявки восстанавливаются (рерун с `validate` идёт с пустым черновиком) |
| 5 | Остались недостающие — статус `waiting_applicant` и новая карточка из шага; иначе — `in_review` |

«Не знаю»: `body: 'unknown'` или текст, начинающийся с «не знаю» → `value: null`, `needsReview: true`,
след `asked` → `no_answer`, заявка в `in_review` (диспетчеру), поле больше не спрашивается.

`GET /api/appeals/:id/messages` — история чата в порядке отправки; доступ у автора и диспетчера
(админ — как диспетчер), остальным 403. Ответ: `{ message, ticketId, runId }`, `runId = null`,
если повторный разбор не запускался.

## Хранение

Таблица `appeal_message` создана миграцией `0001`; миграция `0007` добавляет `card jsonb` и индекс.
`saveAppealMessage` идемпотентен (`ON CONFLICT (id) DO UPDATE`), `listAppealMessages` — по `appeal_id`
и `created_at`. В памяти — `MemoryStore` (те же правила сортировки).

## Проверки

```bash
npx tsc --noEmit
npx vitest run modules/clarify-chat apps/api
npx eslint modules/clarify-chat apps/api/src/server.ts apps/api/tests/clarify-chat.test.ts
```

- шаг: есть/нет недостающих, лимит кругов, «Не знаю», отсутствие `db`, вопрос и варианты модели;
- API: карточка создаётся и сохраняется, ответ заполняет поле с `origin: asked` и перезапускает разбор,
  «Не знаю» → `needsReview` + `in_review`, чужой получает 403, повторный разбор не дублирует вопрос,
  с `FEATURES_OFF=clarify-chat` вопросов нет;
- тест-контракт модуля и прогон с выключенным модулем.

## Не поддержано / ограничения

- **Регистрация модуля.** Строка `clarifyChat` в `modules/registry.server.ts` не добавлена — файл вне
  зоны задачи. До регистрации в API модуль работает только там, где передан явно (тесты),
  а в демо вопросов не будет; нужна одна строка в реестре.
- **Статус после первого разбора.** `applyAnalysis` переводит `waiting_applicant → in_review` сразу
  после `POST /api/appeals`, поэтому при первом запуске заявка с вопросом остаётся `in_review`.
  После ответа маршрут сообщений статус выставляет сам. Правка — в ядре (`applyAnalysis` должен
  учитывать `draft.missing`), это задача ядра, не модуля.
- **Ответ «своим текстом» не попадает в `sources`.** Рерун идёт с `validate`, а текст обращения
  неизменен (`appeal` не меняется); повторный разбор всего диалога с `extract` — следующий шаг.
- **Варианты из CMDB** (кабинеты корпуса, техника кабинета) не строятся: шаг берёт справочник
  и варианты модели. Инструменты CMDB есть у агента `intake`, так что варианты приходят оттуда.

## Вопросы по смыслу (2026-11-14, ветка `feature/smart-clarify`)

- Шаг возвращает в `missing` **все** недостающие поля в порядке плана: заданный вопрос первым, формулировки модели
  у каждого. Финализация ядра (`keepAsked` в `packages/core/src/core-steps.ts`) больше не заменяет их шаблонами.
- Шаблон реестра остаётся запасным: если модель не спросила о поле, а оно обязательно.
- `equipment` обязателен только для «железных» категорий (`required.whenCategory` в `data/fields.json`):
  на «Нет доступа к 1С» об оборудовании не спрашиваем.
