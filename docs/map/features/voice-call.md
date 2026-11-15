# Карта фичи: звонок ИИ-оператору по QR (036 + озвучка 039)

Статус: active
Дата: 2026-11-14
Роль: Семён
Связано: [../README.md](../README.md), [../../specs/case9-core.md](../../specs/case9-core.md#37-приём-обращений-из-модулей), [../../history/2026-11.md](../../history/2026-11.md), [emergency.md](emergency.md), [core-contract-update.md](core-contract-update.md)

Член жюри сканирует QR → на телефоне открывается «входящий вызов» → говорит с ИИ голосом → ИИ задаёт 1–2 уточнения
и «кладёт трубку» → заявка уже в очереди у диспетчера, а разговор виден в чате обращения.

Речь не идёт на сервер: `SpeechRecognition` (`ru-RU`) работает в браузере, по сети летит только текст.
Озвучивает **модель** `google/gemini-3.8-flash-lite-tts` через RouterAI (задача 039, единственное исключение
из правила «только Polza»): `POST /api/tts` → WAV, повторные фразы из кэша; при сбое — запасной `speechSynthesis`.
Телефонии (Voximplant, номер РФ) нет — отменена владельцем 2026-11-14.

## Файлы

| Файл | Что там |
| --- | --- |
| `modules/voice-call/server/index.ts` | `defineModule`: маршруты, лимиты частоты, `seed` гостя `u-call-guest`; `voiceRuntime(deps)` — одно состояние звонков на процесс |
| `modules/voice-call/server/dialog.ts` | диалоговый шаг: промпт, `json_schema`-разбор, таймаут 6 с, правило аварии, лимит реплик/времени, `speakable()` |
| `modules/voice-call/server/format.ts` | номер заявки для озвучки: `numberToWords` (0..9999), `ticketNumberWords` («З-…-0602» и «№ 602» → «шестьсот два»), `digitsToWords` |
| `modules/voice-call/server/service.ts` | `turn` (реплика → ответ ИИ), `end` (идемпотентный итог → заявка), схемы входа/выхода, прощания числом словами |
| `modules/voice-call/server/calls.ts` | `CallStore` в памяти, TTL 30 мин, `open/list/get/sweep` |
| `modules/voice-call/server/intake.ts` | итог звонка → `deps.appeals.submit(channel: 'phone', {wait: false})`, гостевой заявитель, разговор в чат |
| `modules/voice-call/server/rate-limit.ts` | `RateLimiter` (скользящее окно) и `clientAddress` (`cf-connecting-ip` → `x-forwarded-for` → `x-real-ip`) |
| `modules/voice-call/server/public-url.ts` | `resolvePublicUrl` (`PUBLIC_WEB_URL` важнее `.demo/public-url`), `parseTunnelUrl` для `demo:tunnel` |
| `modules/voice-call/server/view.ts` | схемы ответов экрана диспетчера |
| `modules/voice-call/prompts/dialog.v1.md` | промпт ИИ-оператора: коротко, без markdown, не больше двух уточнений |
| `modules/voice-call/web/PhoneCallPage.tsx` | публичная `/call`: экран вызова, микрофон, субтитры, таймер, предсинтез по «Ответить», номер заявки |
| `modules/voice-call/web/tts.ts` | клиент озвучки: `fetchSpeech` (`POST /api/tts`), `createVoicePlayer` (один `Audio`, кэш object-URL, таймаут 3 с), `unlock()` для iOS, запасной `speechSynthesis` |
| `modules/voice-call/web/call-flow.ts` | чистые функции страницы звонка (устройство, таймер, путь `/call`, фазы) и `CALL_PREFETCH` — что синтезируем заранее |
| `modules/voice-call/web/CallsPage.tsx` | экран диспетчера: реплики вживую, плашка входящего со звуком, QR |
| `modules/voice-call/web/format.ts` | формат для экрана: устройство вместо номера, длительность, новый звонок, адрес для QR |
| `modules/voice-call/web/voice.css` | стили обоих экранов, только токены `@ugra/ui` |
| `apps/api/src/tts.ts` | `POST /api/tts`: право `appeal.create`, лимит 400 символов, кэш `sha256(голос+текст)` на 200 фраз, 503 без ключа |
| `packages/core/src/ports.ts` | `TtsPort` (`speak`, `available`) — порт синтеза в `Ports` |
| `packages/adapters/src/tts/routerai.ts` | RouterAI `POST /audio/speech`, таймаут 5 с, санитизация ключа в ошибках |
| `packages/adapters/src/tts/pcm-wav.ts` | `pcmToWav` (44 байта, идемпотентно: готовый RIFF/WAVE не оборачиваем), `trimSilence` (срезает паузу 160–280 мс в начале), `isWav`, `wavSeconds` |
| `packages/adapters/src/tts/stub.ts` | `StubTts`: тихий WAV для тестов, `available: false` — в проде без ключа маршрут отвечает 503 |
| `apps/web/src/App.tsx` | одна ветка: путь `/call` рендерит страницу звонка без входа и без оболочки |
| `scripts/check-routerai.ts` | `pnpm check:routerai`: каталог моделей без ключа, живой синтез 4 голосами, задержка и длительность |
| `scripts/demo-tunnel.ts` | `pnpm demo:tunnel`: cloudflared → адрес `*.trycloudflare.com` → QR в терминал → `.demo/public-url` |
| `scripts/voice-sim.ts` | `pnpm voice:sim`: сервер в процессе на `MemoryStore`, сценарии `testset/calls/*.json` |
| `testset/calls/*.json` | три звонка: принтер в 312-м, дым (авария), тишина → текст |
| `apps/api/tests/voice-call.test.ts`, `apps/api/tests/tts.test.ts` | полный путь звонка; `/api/tts`: WAV, кэш, 401/403/400/503, ключ не утекает |
| `modules/voice-call/tests/*` | контракт, диалог, сервис, лимиты, формат, клиент озвучки, адрес QR |

## Путь звонка

1. `/call` (или `#/call`) — `App.tsx` отдаёт `PhoneCallPage` до проверки сессии.
2. «Ответить» — жест пользователя: `getUserMedia({audio:true})` (проверка доступа), «разблокировка» звука
   (тихий WAV в `Audio` + пустая фраза `speechSynthesis` — иначе iOS молчит), `POST /api/session {userId: 'u-call-guest'}`.
3. При открытии страницы — гостевой вход и фоновый предсинтез (`player.prefetch(CALL_PREFETCH)`): приветствие,
   «секунду, записываю» и три типовых уточнения. К нажатию «Ответить» звук уже в кэше, поэтому первый звук
   не ждёт холодного синтеза (он занимает 2,6–4,8 с).
4. Приветствие голосом → `SpeechRecognition` (`lang: 'ru-RU'`, `interimResults: true`, одна фраза, тишина 8 с → пустая реплика).
5. `POST /api/m/voice-call/turn {callId, from, text}` → `{say, done, emergency, turn}`; пока ждём — «Секунду, записываю…» и точки.
6. `say` **сразу субтитром**, затем звук по готовности: `POST /api/tts {text}` → WAV, играет тот же `Audio`; сервер молчит
   дольше 3 с или ответил 503 — фразу читает `speechSynthesis` браузера. Затем снова слушаем.
7. `done` или «Завершить» → `POST /end` с расшифровкой; прощальная фраза называет номер словами («заявка шестьсот два»).
8. `end` собирает обращение `channel: 'phone'` от `u-call-guest` через `ModuleDeps.appeals.submit(..., {wait: false})`;
   заявка появляется сразу, разбор идёт в фоне тем же пайплайном, что у чата. Разговор пишется в чат обращения.
9. Экран показывает номер заявки крупно; экран диспетчера (`/calls`) опрашивает звонки раз в секунду и подхватывает итог.

Без `SpeechRecognition` или без микрофона — то же окно с полем ввода текста; звук остаётся, если доступен.

## API

Маршруты звонка — `/api/m/voice-call/*`, озвучка — отдельный маршрут ядра `/api/tts` (ответ — аудио, не JSON).
Тела проверяются zod.

| Маршрут | Право | Что делает |
| --- | --- | --- |
| `POST /api/m/voice-call/turn` | `appeal.create` | новая реплика заявителя → ответ ИИ; новый `callId` считается звонком |
| `POST /api/m/voice-call/end` | `appeal.create` | итог звонка → заявка; повторный вызов идемпотентен |
| `GET /api/m/voice-call/calls` | `tickets.queue` | все звонки в пределах TTL для экрана диспетчера |
| `GET /api/m/voice-call/calls/active` | `tickets.queue` | идущий звонок или `null` |
| `GET /api/m/voice-call/calls/:id` | `tickets.queue` | один звонок, 404 если нет |
| `GET /api/m/voice-call/public-url` | `tickets.queue` | адрес страницы звонка: `env` / `tunnel` / `null` |
| `POST /api/tts` | `appeal.create` | `{text ≤ 400, voice?}` → WAV (16 бит, моно, 24 кГц), `x-tts-cache: hit\|miss`; 400/401/403/503 |

Лимиты с одного адреса: **6 новых звонков** и **30 реплик** в минуту → 429. Текст реплики ≤ 2000 символов,
расшифровка ≤ 20 строк, подпись устройства ≤ 60 символов, фраза озвучки ≤ 400 символов.

## Решения и правила

- **Озвучка — модель, а не браузер (039).** `google/gemini-3.8-flash-lite-tts` через RouterAI: единственное
  исключение из правила «только Polza». Замер `pnpm check:routerai`: **1,7–2,5 с** на фразу 4–5 с, а через живой
  `/api/tts` холодный запрос — 2,6–4,8 с (повтор из кэша — 0 мс). Поэтому первый звук не может быть «по запросу»:
  при открытии страницы `/call` гость входит и синтезирует приветствие и типовые уточнения в фоне, к нажатию
  «Ответить» они уже в кэше. Повторные фразы берутся из кэша сервера (`sha256(голос+текст)`, ≤ 200 записей
  в памяти процесса) и из кэша браузера (object-URL, ≤ 24 фразы). Цель ≤ 2 с держится кэшем, а не скоростью провайдера.
- **Пауза в начале фразы срезается.** Gemini TTS начинает с 160–280 мс тишины — `trimSilence` (порог 1 %, запас
  30 мс) убирает её на сервере, кэш хранит уже подрезанный звук; вход стал 0–40 мс.
- **RouterAI отдаёт готовый WAV**, а не сырой PCM, даже при `response_format: 'pcm'` (заголовок RIFF/WAVE,
  16 бит, моно, 24 кГц). `pcmToWav` идемпотентен: готовый контейнер возвращается как есть, иначе дописываются
  44 байта — иначе двойной заголовок ломает звук. `response_format: 'mp3'` не падает, но возвращает тот же WAV.
- **Сбой озвучки демо не роняет.** Нет ключа (`TtsPort.available === false`) → `POST /api/tts` отвечает 503;
  нет сети, ответ дольше 3 с или ошибка проигрывания → страница говорит голосом браузера (`speechSynthesis`);
  нет и его → фраза остаётся субтитром. Текст реплики показывается всегда до звука.
- **Ключ RouterAI не утекает:** только из `.env`, в ответах и логах его нет, ошибки провайдера санитизируются
  (`sanitizeSecret`: ключ, `sk-…`, `Bearer …`). Звонок доступен гостю с правом `appeal.create` — на нём и стоит
  `/api/tts`, поэтому чужой без сессии получает 401.
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
  строка в `apps/web/src/shell/lib.ts`, сама иконка — в общем наборе `packages/ui/src/icons.tsx`.
  Экран зарегистрирован веб-модулем, а вкладка показывает его на проекторе без ручного ввода адреса.
- **Страница `/calls` живёт на опросе раз в секунду** и показывает зелёный индикатор «обновляется вживую» со временем
  последнего опроса — по нему видно, что экран смотрит в тот же API. Для показа открывайте её в отдельном окне браузера,
  а не во вкладке предпросмотра: иначе телефон и экран делят одно место. Если у роли нет прав, экран прямо пишет
  «Нужен вход диспетчером».

## Флаг и проверки

- `FEATURES_OFF=voice-call` — `/api/m/voice-call/turn` → 404, звонок не создаётся, остальной продукт работает.
- `pnpm voice:sim` — весь путь без телефона по `testset/calls/*.json`, код выхода ≠ 0 без заявки.
- `pnpm check:routerai` — каталог модели без ключа + живой синтез 4 голосами, задержка и длительность; образцы в `.demo/tts/`.
- `pnpm vitest run modules/voice-call apps/api/tests/voice-call.test.ts apps/api/tests/tts.test.ts packages/adapters/tests/tts.test.ts`.
- SonarQube по ветке: 0 Blocker/Critical/Major, Quality Gate OK.
- В браузере: `http://localhost:5173/call` (микрофон на localhost разрешён) и `http://localhost:5173/#/calls`.
  Без ключа RouterAI страница обязана говорить голосом браузера — это и есть проверка запасного пути.
