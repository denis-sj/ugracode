# SonarQube: анализ кода «до» и «после»

Статус: active
Дата: 2026-11-14
Проект: `ugracode` · **SonarQube Community Build 26.11** · http://localhost:9000
Источник данных: только API SonarQube (`/api/measures/component`, `/api/issues/search`, `/api/hotspots/search`, `/api/qualitygates/project_status`).

## 0. Почему прошлый отчёт был неверным

Прошлые прогоны шли на SonarQube **9.9 LTS**. Встроенный в эту версию TypeScript не знает нашего
`tsconfig.json` (`moduleResolution: Bundler`, `lib: ES2023`): анализатор падал с
`Failed to create program`, но прогон всё равно завершался `EXECUTION SUCCESS`. Файлы `.ts`/`.tsx`
фактически не проверялись, поэтому было «0 замечаний».

Теперь в `docker-compose.yml` стоит образ `sonarqube:community` (26.11, TypeScript 6.0.3). В логе
сканера должна быть строка `Analyzing 443 file(s) from tsconfig /usr/src/tsconfig.json` и не должно быть `ERROR`.

## 1. Quality Gate

| Прогон | Статус |
|---|---|
| Первый честный прогон (до правок) | Bugs 10, Vulnerabilities 1, Code Smells 26, 37 issues |
| Итоговый | **0 issues**, рейтинги A/A/A |
| Итоговый код как новый проект (так его увидит платформа) | **Quality Gate OK**, 0 issues |

## 2. Метрики

| Метрика | До | После |
|---|---|---|
| Bugs | 10 | **0** |
| Vulnerabilities | 1 | **0** |
| Code Smells | 26 | **0** |
| Security Hotspots | 0 | 0 |
| Reliability rating | D | **A** |
| Security rating | C | **A** |
| Maintainability rating | A | A |
| Technical debt | 395 мин | **0** |
| Duplications | 2,0 % | 2,0 % |
| Coverage (Sonar) | 59,1 % | **63,0 %** |
| Строк кода (ncloc) | 50 707 | 52 194 |

## 3. Замечания по правилам (до → после)

| Правило | Что значит | Было | Как исправили |
|---|---|---|---|
| `S8786` | регулярка с квадратичным откатом (ReDoS) | 16 | линейные утилиты `trimEndChars`/`trimChars`/`groupThousands` в `@ugra/contracts` (`packages/contracts/src/text.ts`), разбор без регулярок, однозначные шаблоны (`\S.*`, `(?<!\d)`) |
| `S2871` | `sort()` без функции сравнения | 3 | `localeCompare` |
| `S6848`, `S6845` | обработчики и `tabIndex` на неинтерактивных элементах | 5 | клавиатура перенесена на кнопки (`Select`, `ReviewFields`), `QuoteChip` стал `<button>`, фон модалки — `role="presentation"` |
| `S9379` | атрибут `autoFocus` | 4 | фокус через `ref`/эффект |
| `S6959` | `reduce()` без начального значения | 2 | начальное значение — первый элемент |
| `S6544`, `S4822` | промис в условии и в `try` без `await` | 3 | async-хелпер `startPlayback` в `voice-call/web/tts.ts` |
| `S9383` | промис без обработки | 1 | `void` для `MemoryStore` в прогоне качества |
| `S7727` | функция передана прямо в `.map` | 1 | явная стрелка |
| `S2245` | `Math.random` в идентификаторе | 1 | `crypto.getRandomValues` (работает и по http) |
| `S1313` | «зашитый» IP | 1 | адрес из диапазона для документации RFC 5737 в заглушке CMDB |
| `S7737` | объект-литерал как значение параметра по умолчанию | 1 | константа `AI_ACTOR` |

## 4. Покрытие

Раньше Vitest мерил только серверную логику (84 %), а Sonar считал все исходники, поэтому цифры
расходились. Теперь `coverage.include` в `vitest.config.ts` совпадает с `sonar.sources`:
Vitest **60,2 %** строк по всему коду, Sonar **63,0 %**. Непокрытое — в основном React-компоненты
экранов (`*.tsx`) без юнит-тестов; серверная логика по-прежнему покрыта выше 80 %.

## 5. Как воспроизвести

```bash
docker compose --profile sonar up -d sonar   # http://localhost:9000, логин admin, пароль — SONAR_ADMIN_PASSWORD в .env
pnpm test:coverage                           # coverage/lcov.info
pnpm sonar                                   # токен — SONAR_TOKEN в .env
```

Метрики через API (токен как basic-auth):

```bash
set -a; . ./.env; set +a
curl -s -u "$SONAR_TOKEN": "http://localhost:9000/api/measures/component?component=ugracode&metricKeys=bugs,vulnerabilities,security_hotspots,code_smells,coverage,duplicated_lines_density"
curl -s -u "$SONAR_TOKEN": "http://localhost:9000/api/issues/search?componentKeys=ugracode&resolved=false&facets=severities,rules,files"
```

Quality Gate локального проекта `ugracode` может показывать ERROR по условию «покрытие нового кода
< 80 %»: «новым» считается всё, что изменилось после первого прогона. На платформе анализ первый,
периода нового кода нет — проверено прогоном под новым ключом проекта: Gate **OK**.
