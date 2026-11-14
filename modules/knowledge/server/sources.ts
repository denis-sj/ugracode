import type { AgentContext } from '@ugra/core';

/**
 * Контекст агента `engineer-assistant`: помнит id статей, которые вернули инструменты.
 * Проверка `check()` сверяет ссылки в итоге только с этим множеством — выдуманный
 * источник не пройдёт, даже если статья существует в базе.
 */
export interface KnowledgeAgentContext extends AgentContext {
  knowledgeSources?: Set<string>;
}

/** Множество id статей прогона; создаётся при первом обращении. */
export function sourceIds(ctx: AgentContext): Set<string> {
  const target = ctx as KnowledgeAgentContext;
  target.knowledgeSources ??= new Set<string>();
  return target.knowledgeSources;
}

/** Запомнить статьи из результата инструмента: только на них можно ссылаться в ответе. */
export function rememberArticles(ctx: AgentContext, articles: readonly { id: string }[]): void {
  const ids = sourceIds(ctx);
  for (const article of articles) ids.add(article.id);
}
