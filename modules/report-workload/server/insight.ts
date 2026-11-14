import type { Fact, LlmPort } from '@ugra/core';
import { InsightOutput, type ReportInsight, type WorkloadResult } from '../contracts';

/**
 * Вывод ИИ для О4. Модель уровня `cheap` получает только `facts` — пары «показатель → значение».
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
export function templateInsight(result: WorkloadResult): ReportInsight {
  const summary = result.summary;
  const busiest = result.byEngineer.find((row) => row.assigneeId !== null) ?? result.byEngineer[0];
  const free = [...result.byEngineer]
    .filter((row) => row.assigneeId !== null && !row.overload)
    .sort((left, right) => left.open - right.open)[0];

  if (summary.totalOpen === 0 && summary.totalClosed === 0) {
    return {
      meaning: `За ${result.period.days} дн. заявок нет — нагрузку считать не по чему.`,
      actions: [
        'Проверить, что заявки назначены исполнителям и попали в базу: пустой отчёт чаще значит «нет данных», а не «все свободны».',
      ],
      source: 'template',
      model: null,
    };
  }

  const meaning = `Сейчас открыто ${summary.totalOpen} заявок на ${summary.engineers} инженеров (${summary.avgOpenPerEngineer} на человека), за ${result.period.days} дн. закрыто ${summary.totalClosed}. Перегружено ${summary.overloaded} (порог — больше ${summary.overloadThreshold} открытых).${busiest ? ` Больше всех у ${busiest.name} — ${busiest.open}.` : ''}${free ? ` Свободнее всех ${free.name} — ${free.open}.` : ''}`;

  const actions: string[] = [];
  if (summary.overloaded > 0) {
    actions.push(
      `Разгрузить перегруженных (${summary.overloaded}): перераспределить открытые заявки на инженеров ниже порога.`,
    );
  }
  if (free) {
    actions.push(`Передать часть заявок ${free.name}: у него ${free.open} открытых — есть запас.`);
  }
  actions.push(
    'Сверить баланс подразделений: перекос в одну службу обычно значит, что маршрутизация уводит заявки не туда.',
  );
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
