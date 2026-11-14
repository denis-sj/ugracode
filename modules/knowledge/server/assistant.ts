import type { AgentContext, AgentProfile } from '@ugra/core';
import { EngineerAnswer, type EngineerAnswerResult } from './schemas';
import { sourceIds } from './sources';

export const ENGINEER_ASSISTANT_PROMPT_ID = 'modules/knowledge/prompts/engineer-assistant.v1.md';

/**
 * Проверки кода после схемы: ссылки в ответе — только на статьи, которые вернули
 * инструменты этого прогона (`kb_search`, `kb_get_article`). Выдуманный id
 * возвращается модели как ошибка — она исправляет ответ и сдаёт снова.
 */
export function checkEngineerAnswer(result: EngineerAnswerResult, ctx: AgentContext): string[] {
  const problems: string[] = [];
  const seen = sourceIds(ctx);
  if (result.sources.length === 0) {
    problems.push('нет ссылок на источники: ответ без статей не принимается');
    return problems;
  }
  const unique = new Set<string>();
  for (const source of result.sources) {
    if (unique.has(source.id)) {
      problems.push(`источник «${source.id}» указан дважды`);
      continue;
    }
    unique.add(source.id);
    if (!seen.has(source.id)) {
      problems.push(
        `источника «${source.id}» нет в результатах инструментов — вызывай kb_search или kb_get_article и ссылайся только на найденное`,
      );
    }
  }
  return problems;
}

/**
 * Агент инженера: вопрос базе знаний. Отвечает только по статьям, найденным
 * инструментами; каждая ссылка проверяется кодом. Инструменты — чтение базы знаний.
 */
export const engineerAssistant: AgentProfile<EngineerAnswerResult> = {
  id: 'engineer-assistant',
  promptId: ENGINEER_ASSISTANT_PROMPT_ID,
  tools: ['kb_search', 'kb_get_article', 'tickets_find_similar'],
  submit: EngineerAnswer,
  maxSteps: 5,
  async state(ctx) {
    return {
      now: ctx.clock.now().toISOString(),
      role: ctx.user.role,
      task: 'ответ инженеру по базе знаний',
    };
  },
  check: checkEngineerAnswer,
};
