import { defineModule } from '@ugra/core';

/**
 * Серверная часть `ai-vs-manual` намеренно пустая: сессии замера К4 живут в браузере
 * (localStorage), серверной таблицы у модуля пока нет — ❓ завести таблицу модуля,
 * когда замеры понадобятся отчёту или смене диспетчеров.
 *
 * Модуль объявлен, чтобы у фичи был флаг `enabledByDefault` и работал `FEATURES_OFF=ai-vs-manual`.
 * Точка расширения одна — веб-страница `/measure` (`web/index.ts`).
 */
export default defineModule({
  id: 'ai-vs-manual',
  title: 'С ИИ / без ИИ',
  enabledByDefault: true,
  fields: [],
  steps: [],
  events: [],
  subscribers: [],
  reports: [],
  tools: [],
  agents: [],
});
