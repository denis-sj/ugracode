# Карта фичи: ответ заявителю (020)

Статус: active
Дата: 2026-11-14
Связано: [../README.md](../README.md), [../../specs/case9-core.md](../../specs/case9-core.md#53-ключевые-алгоритмы), [../../specs/case9-features.md](../../specs/case9-features.md), [../../specs/case9-agent-harness.md](../../specs/case9-agent-harness.md), [../../tasks/020-feedback-sentiment.md](../../tasks/020-feedback-sentiment.md)

Заявитель получает понятное сообщение без участия диспетчера, а диспетчер — готовый черновик,
который можно поправить и отправить. Тональности в продукте нет (б6 отклонена): эмоциональное
обращение приоритет не меняет и на ответ не влияет.

## Файлы

| Файл | Что там |
|---|---|
| `modules/applicant-feedback/server/template.ts` | чистые функции шаблонов: `buildReplyTemplate()` (номер, приоритет, срок, что дальше), `buildConfirmation()` (после подтверждения: исполнитель и срок), `formatDue()`, `reactionMinutes()`, `priorityLabel()`, `hasUnknownNumbers()` — защита от выдуманных цифр модели |
| `modules/applicant-feedback/server/index.ts` | `defineModule`: шаг `applicant-feedback.draft`, подписчик `ticket.confirmed`, событие `applicant-feedback.message.sent`, маршрут `POST /tickets/:id/reply` (право `tickets.edit`) |
| `modules/applicant-feedback/prompts/reply.v1.md` | промпт улучшения формулировки (модель `cheap`, только облачный режим) |
| `modules/applicant-feedback/web/format.ts` | `replyDraftFromAnalysis()`, `replyDraftText()`, `replyDraftLabel()` — терпимое чтение `analysis.replyDraft` |
| `modules/applicant-feedback/web/ReplyFooterWidget.tsx` | виджет `applicant-feedback.reply` в слоте `ticket.footer`: редактируемое поле, «Скопировать», «Отправить заявителю» с подтверждением |
| `modules/applicant-feedback/web/index.ts` | `defineWebModule`: слот `ticket.footer`, роли `dispatcher`/`admin` |
| `modules/applicant-feedback/tests/` | шаблоны для 4 приоритетов, пустые данные, шаг, подписчик, маршрут, формат виджета, тест-контракт |

## Шаг `applicant-feedback.draft`

- Стадия `respond`, `order 100`, `reads: ['fields', 'priority']`, `writes: ['replyDraft']`.
- Номер заявки ищется по `appealId` через `ctx.db.listTickets` (как в `clarify-chat`).
- Текст собирает код: «Заявка № … принята, приоритет «…», срок решения — сегодня до 18:00.
  Свяжемся с вами в течение N мин.» Нет приоритета/срока — фраза не добавляется; нет номера —
  «Заявка принята». Ничего не выдумывается.
- Модель (`structured`, tier `cheap`, только `aiMode === 'cloud'`) может переписать формулировку.
  Её текст принимается, только если каждое число есть в шаблоне; иначе и при любой ошибке
  остаётся шаблон (`template: true`). Это шаблон сообщения, а не запасной путь анализа.
- `evaluate` нет: ответ не входит в эталон качества, приоритет и поля оценивают свои шаги.

## Подписчик `ticket.confirmed`

1. Заявка и обращение читаются из `deps.db`; нет заявки или `ticketId` — молча выходим.
2. Текст: «Заявка № … принята, приоритет «…», срок решения — … Исполнитель — ФИО.»
   (без исполнителя — «Заявка передана в работу»).
3. Сообщение `direction: 'out'`, `kind: 'text'` → `deps.db.saveAppealMessage`.
4. Уведомление заявителю → `deps.db.saveNotification` + `deps.ports.notifications.send`
   (канал `inapp`), затем событие `message.sent`. Каждый канал в своём `try/catch`:
   ошибка не валит подтверждение заявки.

## Маршрут ответа диспетчера

`POST /api/m/applicant-feedback/tickets/:id/reply` с телом `{ text }`, право `tickets.edit`
(диспетчер и админ). Сохраняет исходящее сообщение в чат обращения и публикует `message.sent`
и `applicant-feedback.message.sent`. Пустой текст — 400, неизвестная заявка — 404.
Маршрут модуля выбран вместо `POST /appeals/:id/messages`: тот пишет сообщение как `direction: 'in'`
(реплика заявителя), поэтому для ответа диспетчера не подходит.

## Веб

Слот `ticket.footer`, роли `dispatcher`/`admin`. Виджет берёт `replyDraft` из пропсов или сам
загружает `GET /api/tickets/:id/analysis`; пустой/битый черновик — редактор пустой, диспетчер
пишет сам. Кнопки: «Скопировать» и «Отправить заявителю» (второй шаг — подтверждение в карточке).
Отправка идёт на маршрут модуля, поэтому в чате сообщение помечено как исходящее.

## Проверки

```bash
npx vitest run modules/applicant-feedback
```

- 4 приоритета (низкий, средний, высокий, критический) → свои подписи, номер и срок;
- пустые поля → «Заявка принята…» без цифр; нет срока — нет фразы о сроке;
- модель улучшила текст → `template: false`; выдумала число или упала → шаблон;
- в режиме заглушки модель не вызывается;
- подписчик сохраняет сообщение, уведомление и отдаёт его порту; ошибка канала не валит;
- маршрут: 400 на пустой текст, 404 на чужую заявку, сообщение `out`;
- виджет: битый/пустой `replyDraft` → `null`; подписи «шаблон»/«черновик ИИ»;
- тест-контракт и прогон с выключенным модулем (`runModuleContract`).

## Особенности и что не поддержано

- `draft.estimate` (примерное время ремонта) в сообщении не используется: подписчик не видит
  черновик, а в заявке этого поля нет. Нужен доступ к анализу в подписчике или поле в `ticket`.
- Чек-лист действий при аварии в сообщение не попадает: шаг по заданию читает только
  `fields` и `priority`; текст «что делать сейчас» — отдельная задача.
- Карточка заявки в `apps/web` пока не рендерит `ticket.footer`: виджет и регистрация готовы,
  подключение слота — фронтенд-задача.
- Тональности нет: модуля `sentiment`, аспекта и метки не существует (б6).
