# Карта фичи: авария — правила + модель, уведомление дежурному (011)

Статус: active
Дата: 2026-11-14
Связано: [../README.md](../README.md), [../../specs/case9-core.md](../../specs/case9-core.md#53-ключевые-алгоритмы), [../../specs/case9-agent-harness.md](../../specs/case9-agent-harness.md), [../../specs/case9-features.md](../../specs/case9-features.md), [../../specs/case9-ui-design.md](../../specs/case9-ui-design.md), [../../hackathon/case9-brief.md](../../hackathon/case9-brief.md)

Два независимых сигнала аварии: детерминированные правила из `data/emergency-rules.json` и мнение
агента `intake` (`draft.ext.extraction.emergency`). Решение принимает код, не модель.

| Правила | Модель | Итог `draft.emergency.level` |
|---|---|---|
| сработали | `suspected: true` | `confirmed` — «Авария подтверждена» |
| сработал только один | — | `suspected` — «Авария под вопросом» |
| нет | нет | `none` — обычный путь |

## Файлы

| Файл | Что там |
|---|---|
| `modules/emergency/contracts.ts` | zod-схемы `data/emergency-rules.json` (`EmergencyRule`, `EmergencyChecklist`, `EmergencyRulesFile`), `EmergencyEngineer` (`data/engineers.json`), `ExtractionEmergencyHint` (`draft.ext.extraction.emergency`); терпимые читатели `readEmergencyRules()`, `readEmergencyEngineers()`, `readModelEmergency()` |
| `modules/emergency/server/detect.ts` | чистые функции `detectEmergency()`, `matchedRules()`, `ruleSigns()`, `checklistFor()`, `pickDutyEngineers()`; сравнение без регистра и «ё» |
| `modules/emergency/server/evaluate.ts` | `evaluateEmergency()` — метрика `emergency_match` по `expected.emergency` |
| `modules/emergency/server/index.ts` | `defineModule`: шаг `emergency.detect`, событие `emergency.detected`, уведомления |
| `modules/emergency/web/banner.ts` | `emergencyBanner()` — данные плашки `ticket.banner` (уровень, признаки, чек-лист, кого уведомили, время) |
| `modules/emergency/web/index.ts` | `defineWebModule`: виджет `emergency.banner` в слоте `ticket.banner`, роли `dispatcher`/`admin`/`manager` |
| `modules/emergency/tests/` | `emergency.test.ts` (детектор, дежурные, метрика, шаг), `banner.test.ts`, `contract.test.ts` |

## Как ищем признаки

1. Текст — склейка `draft.sources` (входной текст, расшифровка, ответы заявителя).
2. Нормализация: нижний регистр и «ё → е»; длина строки не меняется, поэтому цитата вырезается
   из исходного текста как есть (регистр сохраняется).
3. Совпадение правила — слово (`words`) или regex-шаблон (`patterns`). Совпадение обязано
   начинаться с начала слова: «вода» не срабатывает на «провода». Битый regex считается подстрокой
   и не роняет шаг. С одного правила берём не больше 6 цитат.
4. В данных `data/emergency-rules.json` слова и шаблоны лежат на уровне правила, а `signs` — коды
   (`"smoke"`, `"water_leak"`). Поэтому цитата общего шаблона подписана **id правила**
   (`emergency.fire`): в карточке видно, какое правило сработало. Если правило описывает знак
   объектом `{ sign, words, patterns }`, цитата подписывается кодом знака.
5. Признаки модели добавляются к признакам правил только при `suspected: true`.
6. `rulesMatched` — id сработавших правил; `checklist` — объединение шагов без повторов: свои
   `checklist` правила + чек-лист по `checklistId`.
7. `confidence` — максимум сигналов: правило даёт `0.9` (`RULE_CONFIDENCE`), модель — свою
   уверенность. Нет сигналов — `0`.

## Кого уведомляем

- `data/engineers.json` → `data.extra.engineers`; профиль терпимый: `id`, `skills[{ skill, level }]`,
  `onShift` (поле `level` профиля в данных — строка, поэтому в схему не входит).
- По каждому сработавшему правилу: инженеры `onShift` с навыком из `skills` правила; правило без
  навыка — все на смене. Результаты объединяются, сортируются по `id`.
- Дежурного с нужным навыком нет — **никого** не уведомляем: запасного получателя (руководителя)
  новая спецификация не предусматривает, диспетчер видит аварию в очереди.

## Точки входа

| Что | Где |
|---|---|
| Шаг `emergency.detect` (стадия `assess`, `order 100`, `reads: sources, fields, ext`, `writes: emergency`) | `modules/emergency/server/index.ts` |
| Событие `emergency.detected`, payload `{ level, signs, rules }`, без `ticketId` (`StepContext` его не содержит) | там же |
| Уведомления: `ctx.db.saveNotification` + `ctx.ports.notifications.send` (`inapp`, «Авария по обращению»); ошибки каналов не валят шаг | там же |
| Метрика `emergency_match` по `expected.emergency` | `modules/emergency/server/evaluate.ts` |
| Данные | `data/emergency-rules.json` → `data.extra.emergencyRules`, `data/engineers.json` → `data.extra.engineers` |
| Красный режим (данные плашки) | `modules/emergency/web/banner.ts`, слот `ticket.banner` |

## Веб

`emergencyBanner({ isEmergency, emergency, detectedAt })` — чистая функция: `null`, если аварии нет;
иначе `{ tone, title, ariaLabel, signs, checklist, notifiedUserIds, at }`. Заголовки — «АВАРИЯ» /
«АВАРИЯ ПОД ВОПРОСОМ»; вердикта нет, а заявка помечена аварийной — «под вопросом» без выдуманных
признаков. По [дизайну](../../specs/case9-ui-design.md#2-стиль) авария — только красной точкой,
текстом или тонкой линией, **не** фоном экрана.

Рендер карточки заявки в `apps/web` ещё не подключён (слота `ticket.banner` там нет), поэтому
`component: null`: регистрация и данные готовы, раскладку делает фронтенд-задача.

## Тесты

```bash
npx vitest run modules/emergency
```

- правила + модель → `confirmed`, уверенность — максимум сигналов;
- только правила / только модель → `suspected`; ничего → `none` и пустые массивы;
- «ё»/регистр, цитата из исходного текста, разные правила и объединённый чек-лист без повторов;
- граница слова («провода» ≠ «вода»), битый regex;
- дежурные: навык правила, правило без навыка, нет дежурного с навыком → никого;
- шаг: вердикт, событие `emergency.detected`, уведомления в хранилище и порт, прогресс
  «Авария: подтверждена/под вопросом», ошибка порта не валит шаг, работа без `ctx.db`/`ctx.bus`;
- `evaluate`: 1 за совпадение, 0 за пропуск/ложную тревогу, нет эталона — нет метрик;
- баннер: подтверждено/под вопросом/нет аварии/только `isEmergency`;
- тест-контракт `assertModuleContract` и прогон `runModuleContract` (с выключением модуля).

## Регистрация

`modules/registry.server.ts`: `import emergency from './emergency/server';` и `emergency` в
`serverModules` (алфавитный порядок). `modules/registry.web.ts`: `import emergencyWeb from
'./emergency/web';` и `emergencyWeb` в `webModules`.

## Отклонения от текста задачи

- Схема правил повторяет реальный `data/emergency-rules.json`: `signs: string[]`, `patterns` на
  уровне правила, чек-листы — отдельный раздел `checklists` с `checklistId`. Дополнительно
  поддерживаются `signs: [{ sign, words, patterns }]`, `words`, `checklist`, `condition` и `skills`.
- `reads` шага включает `sources`: текст обращения берётся из черновика, и шаг обязан это объявлять.
- Подписчика на `emergency.detected` нет: уведомление отправляет сам шаг, иначе при подписке оно
  ушло бы дважды.
- Отдельная карта веб-части не заводилась: виджет и его данные описаны здесь, чтобы не добавлять
  новую ветку в дерево документации (`AGENTS.md` вне зоны этой задачи).
