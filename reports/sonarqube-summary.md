# SonarQube: анализ кода «до» и «после»

Статус: active
Дата: 2026-11-14
Проект: `ugracode` · SonarQube Community 9.9.8 · http://localhost:9000
Версия кода: `a897e53` (рабочее дерево с правками задачи 2)
Источник данных: только API SonarQube (`/api/measures/component`, `/api/issues/search`, `/api/hotspots/search`, `/api/qualitygates/project_status`).

## 1. Quality Gate

| Прогон | Время | Статус |
|---|---|---|
| Первый (до правок Dockerfile) | 2026-11-14 ~20:30 | **OK (Passed)** |
| Итоговый (после правок, повторный на текущем коде) | 2026-11-14 ~22:36 | **OK (Passed)** |

В Community Edition условия Quality Gate не настраиваются — платформа возвращает `status: OK`
без conditions. Дополнительно вручную проверено: Blocker / Critical / Major = 0.

## 2. Метрики

| Метрика | До | После | Комментарий |
|---|---|---|---|
| Bugs | 0 | 0 | — |
| Vulnerabilities | 0 | 0 | — |
| Security Hotspots | **4** | **0** | 4 в Dockerfile: `COPY . .` и root-пользователь |
| Code Smells | 0 | 0 | — |
| Coverage | 83,0 % | 83,0 % | `coverage/lcov.info`, Vitest: **84,11 %** строк |
| Duplications | 0,0 % | 0,0 % | — |
| Reliability rating | 1.0 (A) | 1.0 (A) | — |
| Security rating | 1.0 (A) | 1.0 (A) | — |
| Maintainability rating | 1.0 (A) | 1.0 (A) | — |
| Technical debt (`sqale_index`) | 0 | 0 | — |
| Строк кода (ncloc) | 8 225 | 9 135 | новые экраны и журнал ИИ |
| Файлов | 275 | 300+ | новые модули страниц |
| Cognitive complexity | 1 | 1 | — |

## 3. Замечания по серьёзности

| Серьёзность | До | После |
|---|---|---|
| Blocker | 0 | 0 |
| Critical | 0 | 0 |
| Major | 0 | 0 |
| Minor | 0 | 0 |
| Info | 0 | 0 |

Всего issues: **0 → 0** (повторный прогон 22:36). Открытых замечаний нет, поэтому топ-10 правил и топ-10 файлов пусты —
платформа не нашла ни одного issue в `apps`, `packages`, `modules`.

## 4. Security Hotspots (проверены вручную)

| Правило | Файл | Строка | Статус «до» | Что сделано |
|---|---|---|---|---|
| `docker:S6470` | `apps/api/Dockerfile` | 9 | TO_REVIEW | заменили `COPY . .` на явные `COPY` каталогов |
| `docker:S6470` | `apps/web/Dockerfile` | 9 | TO_REVIEW | то же |
| `docker:S6471` | `apps/api/Dockerfile` | 1 | TO_REVIEW | добавили `USER node` (не-root) |
| `docker:S6471` | `apps/web/Dockerfile` | 1 | TO_REVIEW | то же |

После правок: **0 hotspots**. Образы пересобраны и проверены (`/api/health` через веб-прокси отвечает).

## 5. Что исправлено

1. **6 вызовов `console.log`** вне тестов (`packages/db/src/migrate.ts`, `packages/db/src/seed/index.ts`)
   заменены на общий `packages/db/src/log.ts` (`process.stdout.write`).
2. **Dockerfile**: явные `COPY` вместо рекурсивного `COPY . .`, непривилегированный пользователь `node`.
3. Подключено покрытие: `@vitest/coverage-v8` (3.2.7), `pnpm test:coverage`, lcov, пороги 60/60/60/50,
   шаг в CI. Серверная логика — **84,11 %** строк (цель ≥ 60 %).
4. Убран TODO про lcov, добавлен `pnpm sonar`, токен только в `.env`.

## 6. Что не исправлено и почему

Открытых Blocker / Critical / Major / Minor / Info — **нет**. Сознательно оставлено:

- `packages/db/src/pg-store.ts` и `schema.ts` — 0 % покрытия: требуют живого PostgreSQL, в юнит-тестах
  используется `MemoryStore`; интеграционные тесты с базой вынесены за рамки задачи. Общее покрытие выше порога.
- Security Hotspots после проверки закрыты правками Dockerfile; подавлять правила в Sonar не потребовалось.

## 7. Как воспроизвести

```bash
# покрытие
pnpm install
pnpm test:coverage               # создаёт coverage/lcov.info, печатает таблицу

# SonarQube (локально)
docker compose --profile sonar up -d sonar   # http://localhost:9000
# токен: My Account → Security → Generate Tokens → в .env: SONAR_TOKEN=...
pnpm sonar

# метрики через API (токен из .env)
set -a; . ./.env; set +a
curl -s -u "$SONAR_TOKEN": "http://localhost:9000/api/measures/component?component=ugracode&metricKeys=bugs,vulnerabilities,security_hotspots,code_smells,coverage,duplicated_lines_density"
curl -s -u "$SONAR_TOKEN": "http://localhost:9000/api/issues/search?componentKeys=ugracode&resolved=false&facets=severities,rules,files"
curl -s -u "$SONAR_TOKEN": "http://localhost:9000/api/hotspots/search?projectKey=ugracode"
```

Примечание: SonarQube 9.9 принимает токен в API как basic-auth (`-u "$SONAR_TOKEN":`), заголовок
`Authorization: Bearer` для этих эндпоинтов возвращает 401.
