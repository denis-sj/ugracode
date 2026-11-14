# 030. История настройки: точность от прогона к прогону

Статус: todo (ждёт 014)
Дата: 2026-11-14
Роль: Семён
Исполнитель: —
Ветка: feature/tuning-history
PR: —
Связано: [../specs/case9-features.md](../specs/case9-features.md#4-фича--модуль--задача), [../specs/case9-core.md](../specs/case9-core.md), [../ideas/case9-brainstorm.md](../ideas/case9-brainstorm.md), [README.md](README.md#скиллы-superpowers-для-семёна)

Приоритет: **COULD (в самом конце)**. Папки: `modules/quality/`, `reports/`.

## Что сделать

1. `pnpm eval` дописывает строку в `reports/quality-history.md`: дата, модель, версия промпта, итоговая точность.
2. График или таблица «прогон 1 — 70 % → прогон 5 — 94 %» для слайда.

## Критерии готовности

- **Работает в демо:** на слайде видно, как росла точность.
- Тесты: успешный путь и каждая ветка ошибки. `pnpm check` зелёный, тест-контракт модулей проходит.
- Нет новых замечаний SonarQube уровня Blocker / Critical / Major.

## Блокеры

Задача 014.
