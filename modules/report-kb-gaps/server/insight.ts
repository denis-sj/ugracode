import type { Fact, LlmPort } from '@ugra/core';
import { InsightOutput, type KbGapsResult, type ReportInsight } from '../contracts';

/**
 * Вывод ИИ для О6. Модель уровня `cheap` получает только `facts`.
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
export function templateInsight(result: KbGapsResult): ReportInsight {
  const summary = result.summary;
  const top = result.themes[0];

  if (summary.total === 0) {
    return {
      meaning: `За ${result.period.days} дн. заявок нет — пробелы базы знаний считать не по чему.`,
      actions: [
        'Проверить, что заявки за период поступали и попали в базу: пустой отчёт чаще значит «нет данных», а не «база полная».',
      ],
      source: 'template',
      model: null,
    };
  }

  const meaning = top
    ? `За ${result.period.days} дн. — ${summary.total} заявок, из них ${summary.withoutArticle} без подходящей статьи (${summary.shareWithoutArticlePercent ?? 'нет данных'}%). Чаще всего не хватает темы «${top.label}» — ${top.count} обращений. Тем для пополнения: ${summary.themes}.`
    : `За ${result.period.days} дн. — ${summary.total} заявок; по всем нашлась статья базы знаний. Пробелов не видно.`;

  const actions = top
    ? [
        `Написать статью по теме «${top.label}»: она закрывает ${top.count} обращений — это самый частый пробел.`,
        'Разобрать остальные темы из таблицы: повторяющиеся симптомы без статьи снова уходят инженеру вручную.',
        'Проверить, что найденные статьи действительно подходят: совпадение по словам не равно решению.',
      ]
    : [
        'Держать базу знаний под наблюдением: новые симптомы появятся с новым оборудованием и обновлениями ПО.',
      ];
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
