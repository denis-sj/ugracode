# Модуль `clarify-chat`

Что делает: шаг `clarify.missing` (стадия `validate`, `order 200`) считает кодом недостающие обязательные поля (`missingFields` по реестру, с учётом уже сохранённых полей заявки) и задаёт **один вопрос за раз**: берёт вопрос модели из `draft.ext.extraction.clarify`, иначе шаблон из `FieldDef.ask`, проверяет варианты (справочник — только его значения), пишет сообщение `question_card` в `appeal_message` (`ctx.db.saveAppealMessage`), публикует `message.sent` и переводит заявку в `waiting_applicant`.
Правила: одно поле спрашиваем не больше `maxClarifyRounds` раз (настройка, по умолчанию 2); на «Не знаю» поле больше не спрашиваем — след `no_answer` уходит диспетчеру; если ответа ещё нет (последнее сообщение по полю — вопрос), второй раз не спрашиваем.
Точки расширения: `steps` (`clarify.missing`, `reads: ['fields','missing']`, `writes: ['missing','ext']`), история чата — таблица ядра `appeal_message` через `KernelStore.saveAppealMessage` / `listAppealMessages`, маршруты `GET|POST /api/appeals/:id/messages` — в ядре.
Флаг фичи: `enabledByDefault: true`; выключение — `FEATURES_OFF=clarify-chat` (вопросов нет, заявка сразу уходит диспетчеру).
Момент демо: «опять ничего не работает» → карточка «Какая категория?» с вариантами из справочника и «Не знаю»; ответ заполняет поле с `origin: asked` и следами «спросили → ответил», заявка пересобирается.
