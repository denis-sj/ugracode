import type { Fact, LlmPort } from '@ugra/core';
import { InsightOutput, type EmergencyResult, type ReportInsight } from '../contracts';

/**
 * Вывод ИИ для О7. Модель уровня `cheap` получает только `facts`.
 * Каждое число в тексте обязано быть среди фактов, иначе показываем шаблон.
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

/** Запасной вывод: собирается из цифр отчёта, поэтому не может соврать. */
export function templateInsight(result: EmergencyResult): ReportInsight {
  const summary = result.summary;
  const top = result.hotspots[0];

  if (summary.total === 0) {
    return {
      meaning: `За ${result.period.days} дн. заявок нет — аварии считать не по чему.`,
      actions: [
        'Проверить, что заявки за период поступали: пустой отчёт чаще значит «нет данных», а не «аварий не было».',
      ],
      source: 'template',
      model: null,
    };
  }

  const share = summary.sharePercent === null ? 'нет данных' : String(summary.sharePercent);
  const meaning = `За ${result.period.days} дн. — ${summary.total} заявок, из них ${summary.emergency} аварий (${share}%). Закрыто ${summary.closed}, открыто ${summary.open}; повторных точек — ${summary.repeatedHotspots}. Средняя реакция — ${summary.avgReactionMinutes ?? 'нет данных'} мин.${top ? ` Чаще всего ${top.label}: ${top.count}.` : ''}${summary.falseAlarms === null ? ' Ложные тревоги: журнал сигналов пуст.' : ` Ложных тревог — ${summary.falseAlarms}.`}`;

  const actions: string[] = [];
  if (top) {
    actions.push(
      `Проверить ${top.label}: ${top.count} аварий в одной точке — это не случайность, нужен внеплановый осмотр.`,
    );
  }
  if (summary.open > 0) {
    actions.push(`Довести до результата открытые аварии (${summary.open}): у них короткий срок реакции.`);
  }
  if (summary.falseAlarms !== null && summary.falseAlarms > 0) {
    actions.push(
      `Разобрать ложные тревоги (${summary.falseAlarms}): уточнить признаки в регламенте, чтобы дежурные не выезжали зря.`,
    );
  }
  if (actions.length === 0) {
    actions.push('Держать регламент аварий под наблюдением: новых сигналов и повторов за период нет.');
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
