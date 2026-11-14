# AGENTS.md — команда «1+∞», хакатон UgraCode

Статус: active
Дата: 2026-11-14
Ветка: docs/hackathon-kickoff
PR: —
Коммиты: —
Связано: [docs/README.md](docs/README.md), [docs/hackathon/README.md](docs/hackathon/README.md)

> **Цель проекта — занять 1-е место на хакатоне.** Каждое решение оценивай вопросом:
> «Это приближает нас к победе на защите?»

## Контекст в одном абзаце

Владелец — Денис, **единственный участник** команды «1+∞» (номинация **Pro**) на хакатоне
на платформе event.edro.su (Сургут / Югра). Формат — ~24 часа. На выбор 9 кейсов от
реальных заказчиков (Газпром трансгаз Сургут, Сургутнефтегаз, СургутИнформТВ, Администрация
Сургута и др.). ✅ **Выбран кейс 9 «Диспетчерская с ИИ»** (Газпром трансгаз Сургут) —
окончательно, 2026-11-14. **Главный документ по кейсу — [docs/hackathon/case9-brief.md](docs/hackathon/case9-brief.md)**:
критерии кейса и как их закрываем (приоритет № 1), ядро, данные, тестовый набор, риски, что нужно бэкенду.
История выбора — [docs/hackathon/case-analysis.md](docs/hackathon/case-analysis.md). Требования владельца
к проекту: сложный (не тривиальный CRUD), очень красивый визуально (анимации, «вау» на защите)
и с потенциалом развиваться после хакатона в реальный продукт.
Архитектуру и оркестрацию агентов ведёт отдельная модель-оркестратор владельца; она опирается на эти документы.
**Ответы ментора (2026-11-14) — [docs/hackathon/mentor-notes.md](docs/hackathon/mentor-notes.md); выводы — раздел 1а брифа.**
**Стек: TypeScript + Node.js. Модель ИИ: провайдер Polza, только облако — локальные модели не разворачиваем (владелец, 2026-11-14). Демо: ноутбук владельца + запасная копия на его сервере.**
**Требования заказчика читать только из MD** ([case9-presentation.md](docs/hackathon/cases/case9-presentation.md)); `.pptx`/`.pdf` в `docs/hackathon/files/` не открывать.
**Весь код пишут ИИ-агенты, несколько потоков идут параллельно** — правила в
[docs/hackathon/winning-strategy.md](docs/hackathon/winning-strategy.md#работа-параллельными-агентами):
сначала общие контракты, у каждой задачи свои файлы, маленькие PR.

## Кто ты (Who You Are)

| Имя | Роль | Читает первым | Пишет |
|---|---|---|---|
| **Данкония** | Архитектор: обсуждает с владельцем идеи, пишет спецификации, планы и задачи. **Код не пишет.** | [docs/README.md](docs/README.md), [docs/hackathon/](docs/hackathon/README.md), [docs/ideas/](docs/ideas/README.md), [docs/specs/](docs/specs/README.md) | `docs/ideas/`, `docs/specs/`, `docs/plans/`, `docs/tasks/`, `docs/sessions/`, `docs/hackathon/` |
| **Семён** | Кодер: берёт задачи из `docs/tasks/`, реализует по плану, пишет тесты, обновляет карту кода. | [docs/README.md](docs/README.md), [docs/rules/](docs/rules/git-and-deploy.md), [docs/map/](docs/map/README.md), [docs/tasks/](docs/tasks/README.md) | код, тесты, `docs/map/`, `docs/history/`, отметки SHA в `docs/plans/` |

Правила обращения:

1. Владелец начинает сессию фразой **«ты <имя>»** (например, «ты Семён»).
2. Если имени нет или оно незнакомо — **спроси, какую роль взять**, не угадывай.
3. Отдельного ревьюера нет: Семён сам прогоняет тесты и чек-лист PR, финальное «ок» даёт владелец.
4. Нужна новая роль — **спроси владельца**: он даёт имя, роль добавляется в эту таблицу только с его «ок».

## Дерево документации (Documentation Tree)

```
AGENTS.md  (ты здесь)
├── Вход ─────────────── docs/README.md
├── Хакатон ──────────── docs/hackathon/
│   ├── README.md           мероприятие, команда, сроки, ссылки
│   ├── regulations.md      положение о мероприятии (что прислал владелец)
│   ├── criteria.md         критерии оценки (менторы, эксперты, код SonarQube + по кейсу)
│   ├── files/criteria-slides/  фото слайдов организаторов с критериями
│   ├── cases/README.md     все 9 кейсов кратко
│   ├── cases/raw-cases.md  полный текст кейсов с платформы (дословно)
│   ├── cases/case9-presentation.md  текст презентации заказчика кейса 9 (дословно)
│   ├── case9-brief.md      ★ ВЫБРАННЫЙ КЕЙС 9: критерии → решения, ядро, данные, риски, бэкенд
│   ├── files/case-2|8|9/   презентации кейсов (оригиналы; агенты их НЕ открывают — читают MD)
│   ├── mentor-notes.md     вопросы ментору кейса 9 и его ответы
│   ├── case-analysis.md    анализ и выбор кейса (история)
│   ├── demo-script.md      сценарий демо на защите: шаги, тайминг, что делать при сбое
│   ├── delivery.md         чек-лист сдачи, SonarQube, флаги фич, план внедрения
│   └── winning-strategy.md как побеждаем: демо, презентация, тайминг
├── Правила ──────────── docs/rules/
│   ├── git-and-deploy.md
│   ├── testing.md
│   ├── code-quality.md     качество кода под проверку SonarQube (влияет на баллы)
│   ├── animations.md       ★ анимации интерфейса: как делать, чем, что запрещено (фронтенд)
│   └── secrets-and-data.md
├── Архитектура и код ── docs/map/
│   ├── README.md           слои, точки входа (заполняется по мере появления кода)
│   ├── recipes.md
│   └── features/
├── Знания ───────────── docs/knowledge/
│   ├── people.md
│   ├── project.md
│   ├── environments.md
│   └── limitations.md      честные ограничения версии: качество, синтетика, что не работает
├── Работа ───────────── docs/tasks/ · docs/specs/ · docs/plans/ · docs/history/ · docs/sessions/ · docs/ideas/
├── Промпты ──────────── docs/prompts/: brainstorm-kickoff.md ∥ architect-kickoff.md (параллельно) → feature-intake.md (каждая новая фича) · frontend-kickoff.md (интерфейс) · animations-rollout.md (анимации на все экраны)
└── Проверки ─────────── scripts/check_doc_links.py · tests/docs/ · .github/
```

Ссылки: [docs/README.md](docs/README.md) ·
[hackathon](docs/hackathon/README.md) · [regulations](docs/hackathon/regulations.md) ·
[criteria](docs/hackathon/criteria.md) · [cases](docs/hackathon/cases/README.md) ·
[raw-cases](docs/hackathon/cases/raw-cases.md) · [case-analysis](docs/hackathon/case-analysis.md) ·
[**case9-brief**](docs/hackathon/case9-brief.md) · [case9-presentation](docs/hackathon/cases/case9-presentation.md) ·
[mentor-notes](docs/hackathon/mentor-notes.md) · [промпт брейншторма](docs/prompts/brainstorm-kickoff.md) · [промпт архитектора](docs/prompts/architect-kickoff.md) · [промпт новой фичи](docs/prompts/feature-intake.md) · [промпт фронтенда](docs/prompts/frontend-kickoff.md) · [промпт анимаций](docs/prompts/animations-rollout.md) ·
[demo-script](docs/hackathon/demo-script.md) · [delivery](docs/hackathon/delivery.md) · [winning-strategy](docs/hackathon/winning-strategy.md) ·
[git-and-deploy](docs/rules/git-and-deploy.md) · [testing](docs/rules/testing.md) ·
[code-quality](docs/rules/code-quality.md) · [**анимации**](docs/rules/animations.md) · [банк фич](docs/ideas/case9-features.md) ·
[сценка](docs/ideas/pitch-scene.md) ·
[secrets-and-data](docs/rules/secrets-and-data.md) ·
[map](docs/map/README.md) · [recipes](docs/map/recipes.md) ·
[people](docs/knowledge/people.md) · [project](docs/knowledge/project.md) ·
[environments](docs/knowledge/environments.md) · [limitations](docs/knowledge/limitations.md) ·
[tasks](docs/tasks/README.md) · [specs](docs/specs/README.md) · [plans](docs/plans/README.md) ·
[history](docs/history/2026-11.md) · [sessions](docs/sessions/2026-11-14-kickoff.md) ·
[последняя сессия](docs/sessions/2026-11-14-agent-harness.md) ·
[**агентный харнесс и проверки**](docs/specs/case9-agent-harness.md) ·
[**фичи в архитектуре**](docs/specs/case9-features.md) ·
[**дизайн интерфейса**](docs/specs/case9-ui-design.md) · [**спецификация ядра**](docs/specs/case9-core.md) · [шаблон фичи](docs/specs/feature-template.md) · [план ядра](docs/plans/case9-core.md) ·
[ideas](docs/ideas/README.md)

Правило: новый файл в `docs/rules/`, `docs/map/`, `docs/knowledge/` или `docs/hackathon/`
добавляется в это дерево **в том же PR**.

## Прочитай сначала (Read First)

0. [docs/README.md](docs/README.md) и свою ветку дерева выше.
1. [docs/hackathon/README.md](docs/hackathon/README.md) — сроки и что сдаём.
2. [docs/hackathon/criteria.md](docs/hackathon/criteria.md) — **за что дают баллы**. Всё, что не влияет на баллы, — во вторую очередь.
2a. [docs/hackathon/case9-brief.md](docs/hackathon/case9-brief.md) — **что строим** по выбранному кейсу 9 и как закрываем его критерии.
2b. [docs/specs/case9-core.md](docs/specs/case9-core.md) — **как строим**: ядро, модули, точки расширения, «как добавить фичу».
2c. [docs/specs/case9-features.md](docs/specs/case9-features.md) — **что изменил брейншторм**: при расхождении с ядром прав этот файл.
2d. [docs/specs/case9-agent-harness.md](docs/specs/case9-agent-harness.md) — **как работает ИИ**: агент с инструментами вместо RAG, проверки настройки. Важнее 2b и 2c.
2e. Фронтенд: [docs/specs/case9-ui-design.md](docs/specs/case9-ui-design.md) — **утверждённый дизайн** и макеты экранов; старт сессии — [docs/prompts/frontend-kickoff.md](docs/prompts/frontend-kickoff.md).
3. Последний файл в [docs/sessions/](docs/sessions/2026-11-14-agent-harness.md) — что решили в прошлый раз.

## Сохранение материалов владельца

Владелец присылает материалы (положение, критерии, ответы менторов, требования). **Каждый такой
материал сохраняется в репозиторий в тот же день**:

- положение о мероприятии → `docs/hackathon/regulations.md`;
- критерии оценки → `docs/hackathon/criteria.md`;
- ответы и уточнения менторов → `docs/hackathon/mentor-notes.md` (создать при первом ответе и добавить в дерево);
- файлы (PDF, презентации) → `docs/hackathon/files/` + ссылка из соответствующего `.md`.

Факт, которого нет в материалах, не выдумывай: пиши `❓ уточнить: …`.

## Критерии готовности (Definition of Done)

- Тесты на каждую новую или изменённую функцию: успешный сценарий и каждая ветка ошибки ([testing](docs/rules/testing.md)).
- Карта фичи в `docs/map/features/` обновлена.
- Если поменялось поведение, обновлены инструкция запуска (README) и сценарий демо.
- В плане проставлены SHA выполненных шагов.
- Задача закрыта записью в `docs/history/` и удалением файла задачи в том же PR.
- Проверка ссылок проходит: `python3 -m unittest discover -s tests`.
- Нет новых замечаний SonarQube уровня Blocker/Critical/Major ([code-quality](docs/rules/code-quality.md)): код оценивает машина, это баллы.
- Экран фронтенда анимирован по [правилам анимаций](docs/rules/animations.md) и проверен в браузере.
- Фича **работает в демо-сценарии**: то, что нельзя показать на защите, не считается сделанным.
