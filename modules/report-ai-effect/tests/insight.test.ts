import { describe, expect, it } from 'vitest';
import type { LlmPort, LlmRequest, LlmResult } from '@ugra/core';
import type { AiEffectResult } from '../contracts';
import { allowedNumbers, generateInsight, onlyFactNumbers, templateInsight } from '../server/insight';
import { drilldownOf, factsOf } from '../server';

const result: AiEffectResult = {
  period: { from: '2026-10-15T00:00:00.000Z', to: '2026-11-14T00:00:00.000Z', days: 30 },
  totals: {
    ticketsWithAi: 10,
    fieldsSuggested: 25,
    fieldsCorrected: 4,
    ticketsWithoutEdits: 7,
    shareWithoutEditsPercent: 70,
    avgCorrectionsPerTicket: 0.4,
    avgMinutesToConfirm: 12.5,
    confirmedTickets: 8,
    correctionsByField: [
      { fieldKey: 'cabinet', label: 'Кабинет', corrections: 3, suggestions: 10 },
    ],
  },
  comparison: {
    withAi: { tickets: 10, avgMinutesToConfirm: 12.5 },
    withoutAi: null,
    source: 'none',
    note: 'Замеров ручного режима ещё нет.',
  },
};

const facts = factsOf(result);
const request = {
  title: 'Эффект ИИ',
  question: 'Сколько ИИ делает без правок?',
  promptId: 'modules/report-ai-effect/prompts/insight.v1.md',
};

function llmWith(value: { insight: string; actions: string[] }): LlmPort {
  return {
    async structured<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
      return { value: req.schema.parse(value), model: 'fake-cheap', promptVersion: 'v1', cached: false };
    },
    async chat() {
      throw new Error('chat не нужен');
    },
  };
}

describe('вывод ИИ отчёта О5', () => {
  it('принимает вывод, где числа и запятая взяты из фактов', async () => {
    const insight = await generateInsight(
      llmWith({
        insight: 'Без правок прошли 70% заявок, человек исправил 4 поля, до подтверждения 12,5 мин.',
        actions: ['Уточнить поле «Кабинет»: 3 исправления.'],
      }),
      facts,
      templateInsight(result),
      request,
    );

    expect(insight.source).toBe('ai');
    expect(insight.actions[0]).toContain('Кабинет');
  });

  it('округлять самому нельзя: 13 вместо 12,5 — шаблон', async () => {
    const insight = await generateInsight(
      llmWith({ insight: 'До подтверждения 13 мин.', actions: ['Проверить поля.'] }),
      facts,
      templateInsight(result),
      request,
    );

    expect(insight.source).toBe('template');
  });

  it('без данных ИИ шаблон говорит об этом прямо', () => {
    const empty = templateInsight({
      ...result,
      totals: {
        ...result.totals,
        ticketsWithAi: 0,
        fieldsSuggested: 0,
        fieldsCorrected: 0,
        ticketsWithoutEdits: 0,
        shareWithoutEditsPercent: null,
        avgCorrectionsPerTicket: null,
        avgMinutesToConfirm: null,
        confirmedTickets: 0,
        correctionsByField: [],
      },
    });
    expect(empty.meaning).toContain('нечем');
    expect(empty.actions[0]).toContain('ticket.field.set');
  });

  it('ловит выдуманное число и пропускает число из подписи', () => {
    const allowed = allowedNumbers(facts);
    expect(onlyFactNumbers('Человек исправил 4 поля.', allowed)).toBe(true);
    expect(onlyFactNumbers('Экономия — 5000 рублей.', allowed)).toBe(false);
  });
});

describe('клик по цифре О5', () => {
  it('отдаёт фильтры для правленых и неправленых заявок', () => {
    expect(drilldownOf(result, 'without-edits')).toEqual({ days: 30, corrected: false });
    expect(drilldownOf(result, 'edited')).toEqual({ days: 30, corrected: true });
    expect(drilldownOf(result, 'other')).toEqual({ days: 30 });
  });
});
