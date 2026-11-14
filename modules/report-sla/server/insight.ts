import type { Fact, LlmPort } from '@ugra/core';
import { InsightOutput, type ReportInsight, type SlaResult } from '../contracts';

/**
 * Вывод ИИ для О3. Модель уровня `cheap` получает только `facts` — пары «показатель → значение».
 * Каждое число в тексте обязано быть среди фактов, иначе показываем шаблон: выдумать цифру нельзя.
 */

const NUMBER = /\d+(?:[.,]\d+)?/g;

function normalizeNumber(token: string): string {
  const parsed = Number(token.replace(',', '.'));
  return Number.isFinite(parsed) ? String(parsed) : token;
}

/** Числа, которые модели разрешено повторять: всё, что есть в подписях и значениях фактов. */
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

function percentText(value: number | null): string {
  return value === null ? 'нет данных по сроку' : `${value}% в срок`;
}

/** Запасной вывод: собирается из цифр отчёта, поэтому не может соврать. */
export function templateInsight(result: SlaResult): ReportInsight {
  const summary = result.summary;
  if (summary.total === 0) {
    return {
      meaning: `За ${result.period.days} дн. заявок нет — сроки считать не по чему.`,
      actions: [
        'Проверить, что заявки за период вообще поступали и попали в базу: пустой отчёт чаще значит «нет данных», а не «всё хорошо».',
      ],
      source: 'template',
      model: null,
    };
  }

  const worst = result.worst[0];
  const meaning = `За ${result.period.days} дн. — ${summary.total} заявок: ${summary.closed} закрыто, ${summary.open} в работе. Закрыто ${percentText(summary.slaOnTimePercent)}, с просрочкой ${summary.lateClosed}, открытых просрочено ${summary.openOverdue}. Среднее решение — ${summary.avgResolutionMinutes ?? 'нет данных'} мин, реакция — ${summary.avgReactionMinutes ?? 'нет данных'} мин.${worst ? ` Хуже всех ${worst.number}: просрочка ${worst.lateMinutes} мин.` : ''}`;

  const actions: string[] = [];
  if (summary.openOverdue > 0) {
    actions.push(
      `Разобрать открытые просроченные заявки (${summary.openOverdue}): назначить исполнителя или продлить срок с причиной.`,
    );
  }
  if (summary.lateClosed > 0) {
    actions.push(
      `Разобрать причины просрочки закрытых заявок (${summary.lateClosed}): где теряется время — в назначении, работе или подтверждении.`,
    );
  }
  if (summary.atRisk > 0) {
    actions.push(
      `Предупредить исполнителей о заявках под риском (${summary.atRisk}): срок истекает в ближайшие сутки.`,
    );
  }
  if (actions.length === 0) {
    actions.push('Держать текущий темп: нарушений срока за период нет, следить за новыми заявками с высоким приоритетом.');
  }
  return { meaning, actions, source: 'template', model: null };
}

export interface InsightRequest {
  title: string;
  question: string;
  promptId: string;
}

/**
 * Зовёт модель уровня `cheap` по фактам. Нет ключа, ошибка модели, пустой ответ
 * или число не из фактов — возвращаем шаблон, а не выдуманный текст.
 */
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
    const texts = [value.insight, ...value.actions];
    if (texts.some((text) => !onlyFactNumbers(text, allowed))) return fallback;
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
