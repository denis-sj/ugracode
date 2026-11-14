# Карта фичи: звонок ИИ-оператору по QR (036)

Статус: active
Дата: 2026-11-14
Роль: Семён
Связано: [../README.md](../README.md), [../../specs/case9-core.md](../../specs/case9-core.md#37-приём-обращений-из-модулей), [../../history/2026-11.md](../../history/2026-11.md), [emergency.md](emergency.md), [core-contract-update.md](core-contract-update.md)

Член жюри сканирует QR → на телефоне открывается «входящий вызов» → говорит с ИИ голосом → ИИ задаёт 1–2 уточнения
и «кладёт трубку» → заявка уже в очереди у диспетчера, а разговор виден в чате обращения.

Речь не идёт на сервер: `SpeechRecognition` (`ru-RU`) и `speechSynthesis` работают в браузере, по сети летит только текст.
Телефонии (Voximplant, номер РФ) нет — отменена владельцем 2026-11-14.

## Файлы

| Файл | Что там |
| --- | --- |
| `modules/voice-call/server/index.ts` | `defineModule`: маршруты, лимиты частоты, `seed` гостя `u-call-guest`; `voiceRuntime(deps)` — одно состояние звонков на процесс |
| `modules/voice-call/server/dialog.ts` | диалоговый шаг: промпт, `json_schema`-разбор, таймаут 6 с, правило аварии, лимит реплик/времени, `speakable()` |
| `modules/voice-call/server/service.ts` | `turn` (реплика → ответ ИИ), `end` (идемпотентный итог → заявка), схемы входа/выхода, прощания |
| `modules/voice-call/server/calls.ts` | `CallStore` в памяти, TTL 30 мин, `open/list/get/sweep` |
| `modules/voice-call/server/intake.ts` | итог звонка → `deps.appeals.submit(channel: 'phone', {wait: false})`, гостевой заявитель, разговор в чат |
| `modules/voice-call/server/rate-limit.ts` | `RateLimiter` (скользящее окно) и `clientAddress` (`cf-connecting-ip` → `x-forwarded-for` → `x-real-ip`) |
| `modules/voice-call/server/public-url.ts` | `resolvePublicUrl` (`PUBLIC_WEB_URL` важнее `.demo/public-url`), `parseTunnelUrl` для `demo:tunnel` |
| `modules/voice-call/server/view.ts` | схемы ответов экрана диспетчера |
| `modules/voice-call/prompts/dialog.v1.md` | промпт ИИ-оператора: коротко, без markdown, не больше двух уточнений |
| `modules/voice-call/web/PhoneCallPage.tsx` | публичная `/call`: экран вызова, микрофон и синтез, субтитры, таймер, номер заявки |
| `modules/voice-call/web/call-flow.ts` | чистые функции страницы звонка (устройство, таймер, путь `/call`, голос, фазы) |
| `modules/voice-call/web/CallsPage.tsx` | экран диспетчера: реплики вживую, плашка входящего со звуком, QR |
| `modules/voice-call/web/format.ts` | формат для экрана: устройство вместо номера, длительность, новый звонок, адрес для QR |
| `modules/voice-call/web/voice.css` | стили обоих экранов, только токены `@ugra/ui` |
| `apps/web/src/App.tsx` | одна ветка: путь `/call` рендерит страницу звонка без входа и без оболочки |
| `scripts/demo-tunnel.ts` | `pnpm demo:tunnel`: cloudflared → адрес `*.trycloudflare.com` → QR в терминал → `.demo/public-url` |
| `scripts/voice-sim.ts` | `pnpm voice:sim`: сервер в процессе на `MemoryStore`, сценарии `testset/calls/*.json` |
| `testset/calls/*.json` | три звонка: принтер в 312-м, дым (авария), тишина → текст |
| `apps/api/tests/voice-call.test.ts` | полный путь, идемпотентный `end`, авария, лимиты, флаг, права, гость |
| `modules/voice-call/tests/*` | контракт, диалог, сервис, лимиты, формат, страница звонка, адрес QR |

## Путь звонка

1. `/call` (или `#/call`) — `App.tsx` отдаёт `PhoneCallPage` до проверки сессии.
2. «Ответить» — жест пользователя: `getUserMedia({audio:true})` (проверка доступа), «разблокировка» `speechSynthesis`
   пустой фразой (иначе iOS молчит), `POST /api/session {userId: 'u-call-guest'}`.
3. Приветствие голосом → `SpeechRecognition` (`lang: 'ru-RU'`, `interimResults: true`, одна фраза, тишина 8 с → пустая реплика).
4. `POST /api/m/voice-call/turn {callId, from, text}` → `{say, done, emergency, turn}`; пока ждём — «Секунду, записываю…» и точки.
5. `speechSynthesis` говорит `say` → снова слушаем. `done` или «Завершить» → `POST /end` с расшифровкой.
6. `end` собирает обращение `channel: 'phone'` от `u-call-guest` через `ModuleDeps.appeals.submit(..., {wait: false})`;
   заявка появляется сразу, разбор идёт в фоне тем же пайплайном, что у чата. Разговор пишется в чат обращения.
7. Экран показывает номер заявки крупно; экран диспетчера (`/calls`) опрашивает звонки раз в секунду и подхватывает итог.

Без `SpeechRecognition` или без микрофона — то же окно с полем ввода текста; синтез остаётся, если доступен.

## API

Все маршруты — `/api/m/voice-call/*`; тела проверяются zod.

| Маршрут | Право | Что делает |
| --- | --- | --- |
| `POST /turn` | `appeal.create` | новая реплика заявителя → ответ ИИ; новый `callId` считается звонком |
| `POST /end` | `appeal.create` | итог звонка → заявка; повторный вызов идемпотентен |
| `GET /calls` | `tickets.queue` | все звонки в пределах TTL для экрана диспетчера |
| `GET /calls/active` | `tickets.queue` | идущий звонок или `null` |
| `GET /calls/:id` | `tickets.queue` | один звонок, 404 если нет |
| `GET /public-url` | `tickets.queue` | адрес страницы звонка: `env` / `tunnel` / `null` |

Лимиты с одного адреса: **6 новых звонков** и **30 реплик** в минуту → 429. Текст реплики ≤ 2000 символов,
расшифровка ≤ 20 строк, подпись устройства ≤ 60 символов.

## Решения и правила

- **Почему не `access: 'any'`.** Тест-контракт модулей запрещает маршруты без права. Страница звонка входит гостем
  (`u-call-guest`, роль `applicant`, есть `appeal.create`), поэтому `/turn` и `/end` объявлены с `appeal.create`.
  Лимит частоты по адресу остаётся вторым рубежом.
- **Авария.** Слова «дым, искрит, гарь, пожар, залил сервер/щит, весь этаж» ловит код (`hasEmergencySign`, без модели);
  модель может выставить `emergency: true` сама — оба сигнала ведут к `EMERGENCY_SAY` и `done`. Дальше модуль
  `emergency` в пайплайне сам поднимает аварию по тексту обращения.
- **Таймаут модели 6 с** → запасная фраза `FALLBACK_QUESTION`, звонок не обрывается. Лимит 3 реплики / 90 с →
  вежливое прощание. Тишина → `SILENCE_QUESTION`.
- **Задержка (облако Polza, `deepseek/deepseek-v4.1-flash-1017`):** 1,9–3,5 с на реплику, укладывается в 6 с.
  `max_tokens` ниже ~300 обрезает русский ответ: в порту параметр пока не пробрасывается.
- **Состояние звонков — в памяти процесса.** Перезапуск API стирает список звонков (заявки остаются);
  клиент при `end` присылает расшифровку, поэтому итог не теряется.
- **QR и туннель.** `pnpm demo:tunnel` поднимает `cloudflared tunnel --url http://localhost:5173`, вынимает адрес
  из вывода, печатает QR и пишет `.demo/public-url`; API отдаёт его только роли с `tickets.queue`.
  `PUBLIC_WEB_URL` в `.env` важнее. В Vite добавлен `server.allowedHosts: ['.trycloudflare.com']` (проверено и на
  `vite preview`, который запускается в docker). На docker-стенде `.demo` примонтирована в API только для чтения,
  поэтому адрес не нужно вписывать в `.env` руками.
- **Вкладка в шапке.** У диспетчера и админа появилась вкладка «Звонок» (`/calls`, иконка `phone`):
  строка в `apps/web/src/shell/lib.ts` и контур в `TabIcon.tsx`. Экран зарегистрирован веб-модулем,
  а вкладка показывает его на проекторе без ручного ввода адреса.

## Флаг и проверки

- `FEATURES_OFF=voice-call` — `/api/m/voice-call/turn` → 404, звонок не создаётся, остальной продукт работает.
- `pnpm voice:sim` — весь путь без телефона по `testset/calls/*.json`, код выхода ≠ 0 без заявки.
- `pnpm vitest run modules/voice-call apps/api/tests/voice-call.test.ts`.
- В браузере: `http://localhost:5173/call` (микрофон на localhost разрешён) и `http://localhost:5173/#/calls`.
