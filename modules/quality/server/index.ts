import { defineModule } from '@ugra/core';

/**
 * Модуль `quality` — оценщик качества разбора (задача 014).
 *
 * Шагов, инструментов и агентов у модуля нет: он не участвует в разборе обращения.
 * `pnpm eval` гоняет контрольный набор через общий движок и пишет
 * `reports/quality.md` и `reports/eval-<дата>.json`.
 */
export default defineModule({
  id: 'quality',
  title: 'Оценка качества разбора',
  enabledByDefault: true,
});
