import type { Fact, LlmPort } from '@ugra/core';
import { InsightOutput, type ReportInsight, type ShiftResult } from '../contracts';

/**
 * Вывод ИИ для О1. Модель уровня `cheap` видит только факты отчёта, а код проверяет,
 * что каждое число в её тексте есть среди этих фактов. Иначе — шаблон.
 */

const NUMBER = /\d+(?:[.,]\d+)?/g;

function normalizeNumber(token: string): string {
  const parsed = Number(token.replace(',', '.'));
  return Number.isFinite(parsed) ? String(parsed) : token;
}

export function allowedNumbers(facts: readonly Fact[]): Set<string> {
  const allowed = new Set<string>();
  for (const fact of facts) {
    const source = `${fact.label} ${String(fact.value)}`;
    for (const token of source.match(NUMBER) ?? []) allowed.add(normalizeNumber(token));
  }
  return allowed;
}

export function onlyFactNumbers(text: string, allowed: ReadonlySet<string>): boolean {
  for (const token of text.match(NUMBER) ?? []) {
    if (!allowed.has(normalizeNumber(token))) return false;
  }
  return true;
}

export function templateInsight(result: ShiftResult): ReportInsight {
  const { totals, attention, byAssignee } = result;
  const leader = byAssignee[0];
  const sla = totals.slaOnTimePercent === null ? 'нет данных по сроку' : `${totals.slaOnTimePercent}% в срок`;
  const meaning = `За смену ${result.period.date}: всего ${totals.total}, новых ${totals.created}, закрыто ${totals.closed}, аварий ${totals.emergency}, ${sla}. Просрочено ${attention.overdueCount}, ждут проверки ${attention.waitingReviewCount}.${leader ? ` Больше всего заявок у ${leader.name} — ${leader.total}.` : ''}`;

  const actions: string[] = [];
  if (attention.overdueCount > 0) {
    actions.push(`Разобрать просроченные заявки (${attention.overdueCount}): назначить или продлить срок с причиной.`);
  }
  if (attention.waitingReviewCount > 0) {
    actions.push(`Проверить заявки, ждущие подтверждения (${attention.waitingReviewCount}): без диспетчера они не уйдут в работу.`);
  }
  actions.push(
    totals.emergency > 0
      ? 'Аварийные заявки держать первыми: по ним срок реакции — минуты, а не часы.'
      : 'Смена без аварий — успеть закрыть накопленные проверки до следующей смены.',
  );
  return { meaning, actions, source: 'template', model: null };
}

export interface InsightRequest {
  title: string;
  question: string;
  promptId: string;
}

export async function generateInsight(
  llm: LlmPort,
  facts: readonly Fact[],
  fallback: ReportInsight,
  request: InsightRequest,
): Promise<ReportInsight> {
  try {
    const response = await llm.structured({
      promptId: request.promptId,
      vars: {
        title: request.title,
        question: request.question,
        // Адаптер модели пока не подгружает текст промпта по promptId — ключевое правило дублируем здесь.
        rules: 'Используй только числа из facts. Не считай сам, не округляй, не придумывай цифры.',
        facts: facts.map((fact) => ({ label: fact.label, value: fact.value })),
      },
      schema: InsightOutput,
      tier: 'cheap',
    });
    const value = response.value;
    const allowed = allowedNumbers(facts);
    if ([value.insight, ...value.actions].some((text) => !onlyFactNumbers(text, allowed))) {
      return fallback;
    }
    return {
      meaning: value.insight.trim(),
      actions: value.actions.map((action) => action.trim()).filter((action) => action !== ''),
      source: 'ai',
      model: response.model,
    };
  } catch {
    return fallback;
  }
}
