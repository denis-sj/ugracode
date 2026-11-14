# 036. Звонок по QR-коду: живой ИИ-оператор в браузере телефона

Статус: in progress
Дата: 2026-11-14
Роль: Семён
Исполнитель: Семён
Ветка: feature/phone-ai-operator
PR: —
Связано: [019-voice-call.md](019-voice-call.md), [../specs/case9-agent-harness.md](../specs/case9-agent-harness.md), [../specs/case9-core.md](../specs/case9-core.md#34-порты-и-адаптеры), [../knowledge/environments.md](../knowledge/environments.md#проверка-api-polza-2026-11-14-ключ-владельца), [../rules/secrets-and-data.md](../rules/secrets-and-data.md)

Решения владельца (2026-11-14) — заменяют раздел «Позже: звонок на номер» в задаче 019:

| Вопрос | Решение |
|---|---|
| Формат | **Живой ИИ-оператор**: человек «звонит», ИИ отвечает голосом, задаёт 1–2 уточнения, «кладёт трубку» → заявка уже в очереди у диспетчера |
| Как звонят | **Звонок по QR-коду.** Жюри сканирует QR со слайда → на телефоне открывается наша страница «входящего вызова» → разговор с ИИ. Работает и на ноутбуке |
| Телефония | **Нет.** Voximplant и номер РФ **отменены** (верификация документов не успевается) |
| Речь ↔ текст | **Web Speech API браузера**: распознавание `SpeechRecognition` / `webkitSpeechRecognition` (`lang: 'ru-RU'`), синтез `speechSynthesis` с русским голосом. Звук на сервер не идёт — только текст. Polza для речи не нужна (там 403) |
| LLM | `deepseek/deepseek-v4.1-flash-1017` через Polza — та же модель и тот же пайплайн, что у разбора |
| Ядро | Вариант A: в `packages/core` — `headers` в ctx обработчика модуля и `appeals.submit(appeal) → {ticketId, runId}` в `ModuleDeps` |

## Архитектура

```
Телефон жюри (сканирует QR)          Ноутбук на проекторе
  страница /call (наш web)             экран диспетчера «Входящий звонок»
  ├─ «Входящий вызов», зелёная кнопка     ▲ реплики появляются вживую
  ├─ SpeechRecognition ru-RU → фраза      │ (опрос 1 с или SSE)
  │   POST /api/m/voice-call/turn  ─────► наш API (modules/voice-call/server)
  │   {callId, text}                      ├─ сохраняет реплику
  ├─ speechSynthesis(say)  ◄────────────  ├─ диалоговый шаг LLM → {say, done, emergency}
  └─ … до done или 3 реплик / 90 с        │   (≤ 6 с, иначе запасная фраза)
      POST /api/m/voice-call/end ───────► └─ appeals.submit(source: 'call') → тот же разбор → заявка
      «Заявка № 1042 создана»
```

## Что сделать

1. **Страница звонка** `/call` (`modules/voice-call/web/`), мобильная вёрстка в первую очередь: экран как у входящего вызова
   (аватар «ИИ-диспетчер», пульсирующие кольца, зелёная кнопка «Ответить», красная «Завершить», таймер разговора).
   Нажатие на кнопку — это жест пользователя: в нём запросить микрофон и «разблокировать» `speechSynthesis` (иначе iOS не заговорит).
   Цикл: приветствие голосом («Здравствуйте, это ИИ-диспетчер. Разговор обрабатывает ИИ. Опишите проблему») → слушаем → `turn` →
   говорим ответ → снова слушаем. Пока ждём сервер — фраза «Секунду, записываю» и анимация «думает». Субтитры реплик на экране.
   Индикатор громкости/«слушаю». В конце — номер заявки крупно.
2. **Запасной ввод:** браузер без `SpeechRecognition` (Firefox, часть Android) или отказ в микрофоне → то же окно, но с полем ввода текста;
   синтез речи остаётся, если есть. Об этом — одна строка в интерфейсе, без длинных пояснений.
3. **API** (`modules/voice-call/server/`, маршруты `/api/m/voice-call/*`): `turn`, `end`, `calls/:id`, `calls/active`. Входы через zod.
   Защита от мусора: лимит длины текста, лимит реплик и звонков в минуту с одного адреса. Секрет Voximplant больше не нужен.
4. **Диалоговый шаг LLM**: короткий промпт, `json_schema` `{say: string ≤ 200 символов, done: boolean, emergency: boolean}`, малый `max_tokens`.
   Не больше 2 уточнений (что сломалось, где/кабинет). Признаки аварии (дым, искрит, запах гари, нет связи у всего этажа) →
   `emergency: true`, «Передаю дежурному», дальше — модуль `emergency`. Говорить коротко, без markdown. Замерить задержку и записать.
5. **Экран диспетчера «Входящий звонок»**: активный звонок всплывает сам (с анимацией и звуком вызова), реплики «Заявитель / ИИ» появляются вживую,
   после `end` — ссылка на заявку, которая собирается на глазах.
6. **QR-код**: на экране диспетчера и для слайда — QR на `PUBLIC_WEB_URL/call`. Адрес берётся из `.env`.
7. **Симулятор**: `pnpm voice:sim` — гоняет `turn`/`end` с текстами из `testset/` (тесты и запасной путь демо).
8. **Тесты**: успех; LLM упала или таймаут → запасная фраза; авария → `emergency`; лимит реплик; лимит частоты; модуль выключен флагом;
   правка ядра (`headers`, `appeals.submit`) — успех и ошибка.
9. Документы: `modules/voice-call/README.md` (как запустить с телефона), карта фичи `docs/map/features/voice-call.md`, `.env.example`
   (`PUBLIC_WEB_URL`), шаг в `docs/hackathon/demo-script.md`, ограничения в `docs/knowledge/limitations.md`
   (распознавание делает браузер — Google в Chrome, Apple в Safari; в продукте — серверное распознавание в контуре РФ).

## Ограничения, которые надо учесть

- **Микрофон на телефоне работает только по HTTPS.** На ноутбуке `localhost` подходит. Для телефона нужен HTTPS-адрес: сервер владельца или туннель `cloudflared`.
- Web Speech на iOS Safari и Android Chrome работает, но требует сети (распознавание в облаке браузера). Firefox — запасной ввод текстом.
- Синтез речи на iOS говорит только после жеста пользователя — поэтому всё начинается с кнопки «Ответить».

Папки: `modules/voice-call/`, `testset/` (только звонки). Из общих файлов — своя строка в `modules/registry.*.ts`, `.env.example`, `package.json` (скрипт),
и правка ядра по варианту A отдельным коммитом.

## HTTPS для телефона: туннель с ноутбука (решение владельца, 2026-11-14)

- Туннель — `cloudflared` в режиме быстрого туннеля (`cloudflared tunnel --url http://localhost:5173`): без аккаунта, выдаёт адрес
  `https://<случайно>.trycloudflare.com`. Туннелируем **только web (5173)** — Vite уже проксирует `/api` на API, второй туннель не нужен.
- Vite: в `apps/web/vite.config.ts` добавить `server.allowedHosts: ['.trycloudflare.com']` (иначе Vite отвечает «Blocked request»). Одна строка в общем файле — разрешено.
- Адрес меняется при каждом запуске, поэтому **не держать его в `.env` руками**: скрипт `pnpm demo:tunnel` запускает `cloudflared`,
  вытаскивает адрес из вывода, печатает его и QR в терминал и пишет в `.demo/public-url` (в `.gitignore`); API отдаёт его через
  `GET /api/m/voice-call/public-url`, экран диспетчера рисует QR по нему. Если `PUBLIC_WEB_URL` задан в `.env` — он важнее.
  Нет `cloudflared` — понятная ошибка с командой `brew install cloudflared`.
- Слайд с QR не годится (адрес меняется) — QR показываем **на экране диспетчера** на проекторе.
- Риск: Wi-Fi хакатона может резать туннель → запасной вариант — раздача интернета с телефона владельца; совсем без сети — звонок на самом ноутбуке через `localhost`.

## Что делает владелец

- `brew install cloudflared` (один раз), перед демо — `pnpm demo:tunnel`.
- Перед защитой проверить на своём iPhone/Android: разрешение микрофона, русский голос синтеза.

## Критерии готовности

- **Работает в демо:** член жюри сканирует QR, жмёт «Ответить», говорит «не печатает принтер в 312-м», ИИ переспрашивает голосом,
  «кладёт трубку» — на проекторе у диспетчера появляется звонок с репликами и собранная заявка.
- `pnpm voice:sim` проходит весь путь без телефона.
- `pnpm check` зелёный, с выключенным модулем остальное работает. Нет новых замечаний SonarQube Blocker/Critical/Major.

## Состояние ветки и план для кодера (Данкония, 2026-11-14)

Ветка `feature/phone-ai-operator` отрезана от `feature/core-contract-update` (в `main` пусто). Начинать с неё:
`git checkout feature/phone-ai-operator && pnpm install`. `.env` скопировать из основной папки (в git его нет).

### Уже сделано (не переделывать)

| Коммит | Что |
|---|---|
| `e962ff4` | **Ядро, вариант A** — отдельный коммит, можно влить отдельно. `ModuleDeps.appeals?.submit(appeal, { actor?, wait? })` → `{ appealId, ticketId, ticketNumber, runId }`; `wait: false` — заявка сразу, разбор в фоне. `headers?` в ctx обработчика модуля. `POST /api/appeals` переведён на тот же `createAppealIntake` (`apps/api/src/server.ts`). Тесты `apps/api/tests/module-intake.test.ts` (успех, фон, ошибка хранилища, заголовки). Запись в `docs/specs/case9-core.md` §3.7 |
| `1610eb7`, `61423cb`, `45ff915` | Модуль `modules/voice-call/` (см. ниже), регистрация в `modules/registry.*.ts`, зависимость `qrcode@1.5.4` + `@types/qrcode` в корневом `package.json` |

Файлы модуля:

- `server/dialog.ts` + `prompts/dialog.v1.md` — **диалоговый шаг готов**: `ports.llm.chat` (без инструментов), разбор JSON `{say, done, emergency}`,
  таймаут 6 с → `FALLBACK_QUESTION`; авария по словам кодом (`hasEmergencySign`, без модели) и по `emergency` модели → `EMERGENCY_SAY`;
  лимит 3 реплики / 90 с → `LIMIT_FAREWELL`; тишина → `SILENCE_QUESTION`; `speakable()` чистит markdown и режет до 200 символов.
- `server/calls.ts` — `CallStore` в памяти, TTL 30 мин. `server/service.ts` — `createVoiceService`: `turn`, `end` (идемпотентный, запасная расшифровка с клиента, сбой приёма → вежливое прощание).
- `server/intake.ts` — итог звонка → `deps.appeals.submit(..., { wait: false })`, заявитель `u-call-guest` (создаётся сидом и по месту), разговор пишется в чат обращения.
- `server/rate-limit.ts` — `RateLimiter` (скользящее окно) и `clientAddress(headers)` (`cf-connecting-ip` → `x-forwarded-for` → `x-real-ip` → `local`).
- `server/public-url.ts` — `resolvePublicUrl(env)`: `PUBLIC_WEB_URL` важнее `.demo/public-url`.
- `server/index.ts` — маршруты `POST /turn`, `POST /end`, `GET /calls`, `GET /calls/active`, `GET /calls/:id`, `GET /public-url`; лимиты 6 звонков и 30 реплик в минуту с адреса (429).
- `web/CallsPage.tsx`, `web/format.ts`, `web/voice.css` — экран диспетчера `/calls` (опрос 1 с, реплики пузырями, «ИИ думает», ссылка на заявку, список звонков).
- Тесты: `modules/voice-call/tests/*` — 42 зелёных, 1 красный (ниже).

**Замер задержки (реальный ключ Polza, `deepseek/deepseek-v4.1-flash-1017`):** диалоговый шаг через `ports.llm.chat` — **1,5–3,1 с** на 5 фразах,
укладывается в 6 с. `json_schema` быстрее не делает (2,1–2,4 с). `max_tokens: 120` обрезает русский ответ — не ставить ниже ~300 (и порт его пока не принимает).

### Что осталось — по порядку

1. **Починить тест-контракт (красный).** `assertModuleContract` запрещает модулю маршруты с правом `any`, а `/turn` и `/end` сейчас `any`.
   Решение (не трогать testkit и ядро): страница `/call` при «Ответить» входит гостем — `POST /api/session { userId: 'u-call-guest' }`
   (пользователь уже создаётся сидом модуля; добавить его и в `data/users.json`, если сид не гоняется в демо) — и маршруты `/turn`, `/end`
   объявить с правом `appeal.create`. Лимит частоты по адресу остаётся.
2. **Тесты API** — `apps/api/tests/voice-call.test.ts` по образцу `clarify-chat.test.ts`: полный путь `turn → turn → end` → заявка с `channel: 'phone'`
   и сообщениями в чате; 429 при превышении лимита; `FEATURES_OFF=voice-call` → `/api/m/voice-call/turn` 404, остальное работает;
   `/calls` без права `tickets.queue` → 403.
3. **Публичная страница `/call`** (`modules/voice-call/web/PhoneCallPage.tsx` + чистые функции в `web/call-flow.ts` с тестами):
   - Вход без оболочки: в `apps/web/src/App.tsx` до проверки `boot.user` — если `location.pathname === '/call'` или hash `#/call`, рендерить
     страницу звонка (одна ветка в общем файле). QR ведёт на `<адрес>/call`; Vite в dev отдаёт `index.html` на любой путь.
   - Экран «входящего вызова»: аватар «ИИ-диспетчер», кольца, зелёная «Ответить», красная «Завершить», таймер, субтитры, индикатор «слушаю», в конце — номер заявки крупно.
   - **В обработчике нажатия «Ответить»** (жест!): `getUserMedia({audio:true})`, «разблокировать» `speechSynthesis` (пустая `SpeechSynthesisUtterance`), гостевой вход, приветствие.
   - Цикл: `SpeechRecognition`/`webkitSpeechRecognition` (`lang: 'ru-RU'`, `interimResults: true` для живых субтитров, одна фраза за раз, таймаут тишины ~8 с → пустой текст)
     → `POST /api/m/voice-call/turn {callId, from, text}` (пока ждём — «Секунду, записываю» и анимация) → `speechSynthesis` (голос `ru-RU`) → снова слушаем;
     `done` → `POST /end` → прощание с номером. «Завершить» в любой момент → `end` с `transcript`. `callId` — `crypto.randomUUID()`, `from` — «iPhone»/«Android»/«Компьютер» по userAgent.
   - Нет `SpeechRecognition` или отказ в микрофоне → поле ввода текста (одна строка-пояснение), синтез — если есть.
   - Анимации — только через `@ugra/ui` (`docs/rules/animations.md`); бесконечные — только кольца вызова и «ИИ думает», с `prefers-reduced-motion`.
4. **Экран диспетчера** (`web/CallsPage.tsx`): поправить подписи под QR-сценарий (`formatPhone` → подпись устройства, в `format.test.ts` тоже);
   активный звонок всплывает сам (смена `calls/active` с `null` на звонок → `Modal`/подсветка + короткий звук вызова); QR-код
   (`qrcode` → `toDataURL`) по `GET /api/m/voice-call/public-url`; нет адреса — подсказка «запустите `pnpm demo:tunnel`».
5. **`pnpm demo:tunnel`** (`scripts/demo-tunnel.ts`): `spawn('cloudflared', ['tunnel','--url','http://localhost:5173'])`; `ENOENT` →
   «Нет cloudflared: `brew install cloudflared`»; адрес `https://*.trycloudflare.com` вынуть из stderr (функция `parseTunnelUrl` — отдельно, с тестом
   на образце вывода), напечатать адрес и QR (`qrcode.toString(url + '/call', { type: 'terminal', small: true })`), записать в `.demo/public-url`.
   `.demo/` — в `.gitignore`. В `apps/web/vite.config.ts` — `server.allowedHosts: ['.trycloudflare.com']`. **cloudflared не ставить.**
6. **`pnpm voice:sim`** (`scripts/voice-sim.ts`): поднимает `buildServer` в процессе (как тесты, `MemoryStore`, порты из `.env` — с ключом Polza
   идёт в облако, без — заглушка) и гоняет `turn`/`end` по сценариям из `testset/calls/*.json` (2–3 звонка: принтер в 312, дым → авария, тишина);
   печатает реплики, задержку каждого шага и номер заявки; код выхода ≠ 0, если заявка не создана. Скрипт в `package.json`.
7. **Документы:** `modules/voice-call/README.md` (5 строк по шаблону + «как позвонить с телефона»: туннель, QR, разрешение микрофона),
   `docs/map/features/voice-call.md`, `.env.example` (`PUBLIC_WEB_URL=`), шаг в `docs/hackathon/demo-script.md`, ограничения в
   `docs/knowledge/limitations.md` (распознавание делает браузер — Google в Chrome, Apple в Safari; в продукте — серверное распознавание в контуре РФ;
   состояние звонков в памяти процесса).
8. **Проверка:** `pnpm check` зелёный, `python3 -m unittest discover -s tests`, страница `/call` и экран `/calls` проверены в браузере
   (на ноутбуке — `localhost`, микрофон работает без HTTPS). Затем запись в `docs/history/2026-11.md`, удалить этот файл задачи. PR — только после «ок» владельца.
