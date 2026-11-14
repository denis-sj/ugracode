# Карта фичи: скриншот и фото шильдика (026)

Статус: active
Дата: 2026-11-14
Роль: Семён
Связано: [../README.md](../README.md), [../../specs/case9-core.md](../../specs/case9-core.md#34-порты-и-адаптеры), [../../specs/case9-agent-harness.md](../../specs/case9-agent-harness.md), [../../history/2026-11.md](../../history/2026-11.md), [extraction.md](extraction.md), [clarify-chat-ui.md](clarify-chat-ui.md)

Картинка (скриншот ошибки или фото шильдика) → текст (порт зрения) → поля заявки.
Заявитель прикладывает картинку в чате, получает текст распознавания и добавляет его в обращение;
в разборе текст картинки живёт источником `kind: 'image'`, поэтому цитаты полей ссылаются на него.

## Файлы

| Файл                                          | Что там                                                                                                                          |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `modules/screenshot/server/index.ts`          | `defineModule`: id `screenshot`, `enabledByDefault: true`, шаг `screenshot.read`, агент `vision`                                 |
| `modules/screenshot/server/image-source.ts`   | соглашение о картинке в черновике: `findImageSource`, `stripDataUrl` (`label` = mimeType)                                        |
| `modules/screenshot/server/fields.ts`         | `fieldsFromVision`: `symptoms` / `errorCode` / `model` из текста, порог уверенности, цитата на источник картинки                 |
| `modules/screenshot/contracts.ts`             | `VisionSubmit` (`submit` агента), `ScreenshotExt` (`draft.ext.screenshot`)                                                       |
| `modules/screenshot/prompts/read.v1.md`       | промпт агента `vision` и порта зрения (один файл, версия в id)                                                                   |
| `modules/screenshot/web/index.ts`             | веб-модуль: виджет `applicant.chat.footer`, роль `applicant`                                                                     |
| `modules/screenshot/web/ScreenshotWidget.tsx` | кнопка «Скриншот», скрытый `input accept="image/*"`, панель «Распознано» с кнопками «Добавить в обращение» / «Скопировать текст» |
| `modules/screenshot/web/image.ts`             | `imageFileProblem` (тип, пустой, > 8 МБ), `toBase64`, `screenshotInput`, `readImageFile`                                         |
| `modules/screenshot/web/screenshot.css`       | стили панели, только токены `packages/ui`                                                                                        |
| `modules/screenshot/README.md`                | пять строк: что делает, точки расширения, флаг, момент демо, ограничение                                                         |
| `packages/contracts/src/api.ts`               | `ScreenshotInput`, `ScreenshotResponse` (рядом с `TranscribeInput`)                                                              |
| `apps/api/src/server.ts`                      | `POST /api/screenshot` (право `appeal.create`), `stripImagePrefix`, `isBase64Image`                                              |
| `modules/clarify-chat/web/ChatPage.tsx`       | кнопка «Скриншот» в чате: распознанный текст кладётся в поле сообщения через `onText`                                            |
| `apps/api/tests/screenshot.test.ts`           | 401, 200, 400 (пусто / битый base64 / не картинка), 502 (сбой порта, пустой ответ)                                               |
| `modules/screenshot/tests/*`                  | тест-контракт, шаг (нет картинки, успех, низкая уверенность, ошибки), картинка в источниках, base64 в браузере                   |

## Шаг `screenshot.read`

Стадия `enrich`, `order 100`, `reads: ['sources']`, `writes: ['sources', 'fields']`.

1. Ищем в `draft.sources` источник `kind: 'image'`. Соглашение (пока ядро не умеет вложения):
   `text` — картинка в base64 (можно data URL), `label` — mimeType (`image/png`); нет источника или он
   пустой — шаг возвращает `{}` и ничего не пишет.
2. `ports.vision.describe({kind: 'image', data, mimeType}, 'modules/screenshot/prompts/read.v1.md')`.
   Порт сам выбирает режим (`stub` / `cloud`); агент `vision` объявлен для реестра и промпта,
   вход у него — картинка, поэтому инструментов нет, итог — один `submit` (`VisionSubmit`).
3. Успех: новый источник `{id: 'screenshot.read:<id>', kind: 'image', text, label: 'Текст со скриншота'}`
   и поля `symptoms` (первая строка), `errorCode` (по слову-подсказке + код), `model` (по слову «модель»).
   Поля пишутся, только если они есть в реестре; `origin: 'text'`, `confidence` — из ответа порта
   (по умолчанию 0,6), `needsReview` — ниже порога `confidenceThreshold`, цитата и след `found` ссылаются
   на источник картинки.
4. Ошибка порта или пустой текст: шаг не падает, добавляет источник-пометку «Скриншот не распознан»
   и `ext.screenshot = {status: 'failed', error}` — по этой пометке заявка уходит диспетчеру.

Поля из шага — подстраховка: основной разбор полей делает `extraction.fields`, который читает источники
черновика, то есть видит текст картинки и ставит на него цитаты.

## API

`POST /api/screenshot`, право `appeal.create` (есть у всех ролей, то есть любой вошедший).

| Вход / выход | Схема                                                             |
| ------------ | ----------------------------------------------------------------- |
| вход         | `{ image: string (base64, можно data URL), mimeType: 'image/*' }` |
| выход        | `{ text: string, confidence?: number }`                           |
| 400          | пустая картинка, битый base64, `mimeType` не `image/*`            |
| 401          | нет входа                                                         |
| 502          | порт зрения упал или вернул пустой текст                          |

Лимит тела запроса — 25 МБ (общий для API), виджет просит картинку до 8 МБ.

## Веб

Виджет `screenshot.upload` объявлен в слоте `applicant.chat.footer`. ❓ Оболочка пока не рисует этот слот
(`WebPageProps` не отдаёт странице список виджетов), поэтому компонент подключён напрямую в
`modules/clarify-chat/web/ChatPage.tsx`: `onText` кладёт распознанный текст в поле сообщения, `onError` —
в общую строку ошибок чата. Когда слот появится в оболочке, прямая вставка убирается, виджет остаётся один.

## Флаг и проверки

- `FEATURES_OFF=screenshot` — шага нет, кнопки нет (виджет не регистрируется), остальной разбор работает.
- `pnpm vitest run modules/screenshot apps/api` — шаг, контракт модуля, API картинки.
- Серверная регистрация модуля (строка в `modules/registry.server.ts`, файл чужой для задачи):
  `import screenshot from './screenshot/server';` + `screenshot` в `serverModules`.
  Веб-регистрация (`modules/registry.web.ts`): `import screenshotWeb from './screenshot/web';` + `screenshotWeb` в `webModules`.
- Облачный адаптер зрения (`packages/adapters/src/vision/polza.ts`) — вне зоны задачи: сейчас порт всегда
  `StubVision`, поэтому демо показывает фиксированный текст распознавания.
