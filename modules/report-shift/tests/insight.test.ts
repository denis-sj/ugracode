import { describe, expect, it } from 'vitest';
import type { LlmPort, LlmRequest, LlmResult } from '@ugra/core';
import type { ShiftResult } from '../contracts';
import { allowedNumbers, generateInsight, onlyFactNumbers, templateInsight } from '../server/insight';
import { factsOf, drilldownOf } from '../server';

const result: ShiftResult = {
  period: {
    date: '2026-11-14',
    from: '2026-11-14T00:00:00.000Z',
    to: '2026-11-15T00:00:00.000Z',
  },
  totals: {
    total: 12,
    created: 8,
    closed: 7,
    emergency: 1,
    slaBreaches: 2,
    slaOnTimePercent: 71.4,
  },
  byAssignee: [
    {
      assigneeId: 'u-engineer-2',
      name: 'Артём Кузнецов',
      total: 5,
      open: 2,
      closed: 3,
      avgResolutionMinutes: 90,
    },
  ],
  attention: {
    overdue: [],
    overdueCount: 2,
    waitingReview: [],
    waitingReviewCount: 3,
  },
};

const facts = factsOf(result);
const request = {
  title: 'Сводка смены',
  question: 'Что требует внимания?',
  promptId: 'modules/report-shift/prompts/insight.v1.md',
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

describe('вывод ИИ отчёта О1', () => {
  it('принимает вывод только с числами из фактов', async () => {
    const insight = await generateInsight(
      llmWith({
        insight: 'За смену 12 заявок, просрочено 2.',
        actions: ['Разобрать 2 просроченные заявки.'],
      }),
      facts,
      templateInsight(result),
      request,
    );

    expect(insight.source).toBe('ai');
    expect(insight.meaning).toContain('12');
  });

  it('выдуманное число отбрасывает вывод', async () => {
    const insight = await generateInsight(
      llmWith({ insight: 'За смену 42 заявки.', actions: ['Проверить очередь.'] }),
      facts,
      templateInsight(result),
      request,
    );

    expect(insight.source).toBe('template');
  });

  it('ошибка модели и пустой ответ дают шаблон', async () => {
    const broken: LlmPort = {
      async structured() {
        throw new Error('нет ключа');
      },
      async chat() {
        throw new Error('chat не нужен');
      },
    };
    const insight = await generateInsight(broken, facts, templateInsight(result), request);
    expect(insight.source).toBe('template');
    expect(insight.actions.length).toBeGreaterThan(0);
  });

  it('шаблон напоминает про просрочку и проверку', () => {
    const template = templateInsight(result);
    expect(template.meaning).toContain('2026-11-14');
    expect(template.actions.join(' ')).toContain('просроченные');
    expect(template.actions.join(' ')).toContain('ждущие подтверждения');
  });

  it('проверка чисел не пропускает чужое и пропускает дату', () => {
    const allowed = allowedNumbers(facts);
    expect(onlyFactNumbers('Дата 2026-11-14, всего 12 заявок.', allowed)).toBe(true);
    expect(onlyFactNumbers('Всего 13 заявок.', allowed)).toBe(false);
  });
});

describe('клик по цифре О1', () => {
  it('отдаёт фильтры для просрочки, проверки и исполнителя', () => {
    expect(drilldownOf(result, 'overdue')).toMatchObject({ date: '2026-11-14', overdue: true });
    expect(drilldownOf(result, 'waiting-review')).toMatchObject({ status: 'in_review' });
    expect(drilldownOf(result, 'assignee:u-engineer-2')).toMatchObject({
      assigneeId: 'u-engineer-2',
    });
    expect(drilldownOf(result, 'unknown')).toEqual({ date: '2026-11-14' });
  });
});
