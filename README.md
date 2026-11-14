# UgraCode — команда «1+∞»

Репозиторий проекта команды «1+∞» на хакатоне (платформа event.edro.su, номинация Pro).
Кейс 9 «Диспетчерская с ИИ» (Газпром трансгаз Сургут).

- Для ИИ-агентов: начните с [AGENTS.md](AGENTS.md).
- Документация: [docs/README.md](docs/README.md).
- Архитектура и карта кода: [docs/map/README.md](docs/map/README.md).
- Что строим: [docs/hackathon/case9-brief.md](docs/hackathon/case9-brief.md).

## Запуск одной командой

```bash
cp .env.example .env   # значения можно оставить пустыми: демо работает на заглушке
docker compose up --build
```

- Веб: http://localhost:5173
- API: http://localhost:3001/api/health
- База: PostgreSQL 16 + pgvector на порту 5432

## Локальная разработка

```bash
pnpm install
cp .env.example .env
pnpm migrate && pnpm seed
pnpm dev:api     # http://localhost:3001
pnpm dev:web     # http://localhost:5173
```

## Проверки

```bash
pnpm check      # типы + ESLint (границы слоёв) + Vitest
pnpm check:polza  # проверка API Polza, нужен POLZA_API_KEY в .env
python3 -m unittest discover -s tests   # ссылки документации
```

Сквозной срез (текст обращения → заявка с полями):

```bash
npx vitest run apps/api/tests/e2e.test.ts
```

## Архитектура

```
apps (api, web) → modules → adapters, db → core → contracts
```

Маленькое ядро + модули: новая фича — папка в `modules/` и одна строка в `modules/registry.server.ts`.
Подробности — [docs/specs/case9-core.md](docs/specs/case9-core.md) и [docs/map/README.md](docs/map/README.md).
