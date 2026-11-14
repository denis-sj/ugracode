import type { Fact, LlmPort } from '@ugra/core';
import { InsightOutput, type HotspotsResult, type ReportInsight } from '../contracts';

/**
 * Вывод ИИ для О2. Модель уровня `cheap` получает только `facts` — пары «показатель → значение».
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

function trendText(trend: number | null): string {
  if (trend === null) return 'сравнить с прошлым периодом не с чем';
  if (trend === 0) return 'столько же, сколько в прошлом периоде';
  return `на ${Math.abs(trend)}% ${trend > 0 ? 'больше' : 'меньше'} прошлого периода`;
}

/** Запасной вывод: собирается из цифр отчёта, поэтому не может соврать. */
export function templateInsight(result: HotspotsResult): ReportInsight {
  const top = result.rows[0];
  const meaning = top
    ? `За ${result.period.days} дн. — ${result.total} заявок, из них ${result.repeatedTickets} в точках с повторами. Главная точка — ${top.label}: ${top.count} обращений (${top.sharePercent}% всех), ${trendText(top.trendPercent)}.`
    : `За ${result.period.days} дн. — ${result.total} заявок, привязанных к месту нет: горячих точек не видно.`;
  const actions = top
    ? [
        top.count >= 2
          ? `Проверить ${top.label}: ${top.count} обращений — это повторная поломка. Если ремонт не помог, заменить технику дешевле повторных выездов.`
          : `Держать ${top.label} на контроле: пока это одно обращение, а не тенденция.`,
        'Разобрать остальные точки из таблицы: повторные выезды в один кабинет дороже плановой замены.',
      ]
    : ['Проверить, что заявкам заполняют корпус и кабинет: без места отчёт не находит повторные поломки.'];
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
