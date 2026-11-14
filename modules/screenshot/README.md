# Модуль `screenshot`

Что делает: шаг `screenshot.read` (стадия `enrich`, `order 100`) берёт источник `kind: 'image'` из `draft.sources` (base64 + mimeType), зовёт `VisionPort.describe` с промптом `prompts/read.v1.md` и кладёт текст распознавания новым источником `kind: 'image'`, а из него достаёт поля `symptoms`, `errorCode`, `model` с `origin: 'text'` и уверенностью зрения; картинки нет — шаг ничего не меняет.
Точки расширения: `steps` (`screenshot.read`, `reads: sources`, `writes: sources, fields`), агент `vision` (без инструментов, `submit: {text, program?, errorCode?, model?, serial?}`), веб-виджет `applicant.chat.footer` (кнопка «Скриншот» → `POST /api/screenshot`), `draft.ext.screenshot` (`{status: recognized|failed, sourceId?, confidence?, error?}`) для карточки заявки.
Флаг фичи: `enabledByDefault: true`; выключение — `FEATURES_OFF=screenshot` (шага и кнопки нет, картинки не распознаются, остальной разбор работает).
Момент демо: заявитель прикладывает скриншот ошибки — текст распознавания появляется в чате, код ошибки приходит в заявку с пометкой «из изображения»; не распозналось — в `ext.screenshot` пометка «не распознано», заявка уходит диспетчеру.
Ограничение: порт зрения пока заглушка (`StubVision`, облачный адаптер Polza — отдельная задача в `packages/adapters`); слот `applicant.chat.footer` оболочка пока не рисует, кнопка подключена в чат напрямую.
