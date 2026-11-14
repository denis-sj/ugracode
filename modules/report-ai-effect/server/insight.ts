import type { Fact, LlmPort } from '@ugra/core';
import { InsightOutput, type AiEffectResult, type ReportInsight } from '../contracts';

/**
 * Вывод ИИ для О5. Модель уровня `cheap` видит только факты; код проверяет,
 * что каждое число в её тексте есть среди фактов. Иначе — шаблон.
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

export function templateInsight(result: AiEffectResult): ReportInsight {
  const { totals, period } = result;
  if (totals.ticketsWithAi === 0) {
    return {
      meaning: `За ${period.days} дн. событий полей ИИ нет — эффект измерить нечем.`,
      actions: ['Проверить, что разбор пишет событие ticket.field.set: без него доля правок не считается.'],
      source: 'template',
      model: null,
    };
  }

  const share = totals.shareWithoutEditsPercent ?? 'нет данных';
  const avg = totals.avgCorrectionsPerTicket ?? 'нет данных';
  const confirm =
    totals.avgMinutesToConfirm === null ? 'подтверждений не было' : `${totals.avgMinutesToConfirm} мин до подтверждения`;
  const top = totals.correctionsByField[0];
  const meaning = `За ${period.days} дн. ИИ предложил ${totals.fieldsSuggested} значений в ${totals.ticketsWithAi} заявках, человек исправил ${totals.fieldsCorrected}. Без правок — ${share}% заявок, в среднем ${avg} правок на заявку, ${confirm}.${top ? ` Чаще всего исправляют «${top.label}» — ${top.corrections}.` : ''}`;

  const actions: string[] = [];
  if (top && top.corrections > 0) {
    actions.push(`Уточнить промпт и подсказки для поля «${top.label}»: ${top.corrections} исправлений человеком.`);
  }
  if (typeof share === 'number' && share < 70) {
    actions.push('Разобрать исправленные поля по журналу: где ИИ ошибается системно, а не разово.');
  } else {
    actions.push('Держать контроль на подтверждении: правки всё равно проходят через диспетчера.');
  }
  actions.push('Сравнить с ручным режимом, когда появятся замеры: сейчас в отчёте только сторона «с ИИ».');
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
