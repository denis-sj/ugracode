# Карта фичи: качество кода и SonarQube

Статус: active
Дата: 2026-11-14
Связано: [../README.md](../README.md), [../../rules/code-quality.md](../../rules/code-quality.md), [../../hackathon/delivery.md](../../hackathon/delivery.md), [../../../reports/sonarqube-summary.md](../../../reports/sonarqube-summary.md)

## Что подключено

| Что | Где |
|---|---|
| Покрытие Vitest (v8, lcov) | `vitest.config.ts`, `pnpm test:coverage` → `coverage/lcov.info` |
| Пороги покрытия | 60 % строк/операторов/функций, 50 % ветвей (серверная логика) |
| CI | `.github/workflows/check.yml`: `pnpm check` + `pnpm test:coverage` |
| Sonar-конфиг | `sonar-project.properties` (источники `apps`, `packages`, `modules`; исключены docs/reports/coverage) |
| Запуск анализа | `docker compose --profile sonar up -d sonar`, затем `pnpm sonar` |
| Токен | только `.env` (`SONAR_TOKEN`), в репозиторий не попадает |
| Логи CLI без `console` | `packages/db/src/log.ts` |

## Результат 2026-11-14

- Quality Gate **OK**, issues **0** по всем серьёзностям.
- Security Hotspots: **4 → 0** после правок Dockerfile (`COPY` без рекурсии, `USER node`).
- Покрытие: Sonar **83 %**, Vitest **84,11 %** строк.
- Дубликаты **0 %**, рейтинги Reliability/Security/Maintainability — **A (1.0)**.
- Подробности «до/после» — [reports/sonarqube-summary.md](../../../reports/sonarqube-summary.md).

## Как проверить

```bash
pnpm test:coverage
docker compose --profile sonar up -d sonar
pnpm sonar
```

## Ограничения

- Sonar в CI не настроен: `SONAR_TOKEN` и доступный сервер нужны в секретах GitHub.
- `pg-store.ts`/`schema.ts` не покрыты юнит-тестами — нужен живой PostgreSQL; общее покрытие выше порога.
