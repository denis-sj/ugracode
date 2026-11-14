import { describe, expect, it } from 'vitest';
import type { LlmPort, LlmRequest, LlmResult } from '@ugra/core';
import type { SlaResult } from '../contracts';
import { allowedNumbers, generateInsight, onlyFactNumbers, templateInsight } from '../server/insight';
import { factsOf } from '../server';

const result: SlaResult = {
  period: { from: '2026-10-15T12:00:00.000Z', to: '2026-11-14T12:00:00.000Z', days: 30 },
  filters: {},
  summary: {
    total: 10,
    closed: 8,
    open: 2,
    cancelled: 0,
    dueKnown: 8,
    onTimeClosed: 6,
    lateClosed: 2,
    openOverdue: 1,
    atRisk: 1,
    slaOnTimePercent: 75,
    reactionKnown: 6,
    reactionMeasured: 6,
    reactionOnTime: 5,
    reactionBreaches: 1,
    reactionOnTimePercent: 83.3,
    avgReactionMinutes: 42,
    avgResolutionMinutes: 310,
    avgLateMinutes: 95,
  },
  byPriority: [
    {
      priority: 'critical',
      label: 'Критический',
      total: 4,
      closed: 3,
      lateClosed: 2,
      openOverdue: 1,
      breaches: 3,
      onTimePercent: 33.3,
      avgResolutionMinutes: 400,
      avgLateMinutes: 95,
    },
  ],
  byDepartment: [
    {
      departmentId: 'dep-network',
      label: 'Сети и связь',
      total: 6,
      closed: 5,
      lateClosed: 2,
      openOverdue: 1,
      breaches: 3,
      onTimePercent: 60,
      avgResolutionMinutes: 350,
    },
  ],
  worst: [
    {
      id: 't-9',
      number: 'З-0009',
      priority: 'critical',
      status: 'assigned',
      assigneeId: 'u-engineer-2',
      assigneeName: 'Артём Кузнецов',
      departmentId: 'dep-network',
      dueAt: '2026-11-13T10:00:00.000Z',
      lateMinutes: 1440,
      state: 'overdue-open',
    },
  ],
};

const facts = factsOf(result);
const request = {
  title: 'Сроки',
  question: 'Где опаздываем?',
  promptId: 'modules/report-sla/prompts/insight.v1.md',
};

function llmWith(value: { insight: string; actions: string[] }, model = 'fake-cheap'): LlmPort {
  return {
    async structured<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
      return { value: req.schema.parse(value), model, promptVersion: 'v1', cached: false };
    },
    async chat() {
      throw new Error('chat не нужен');
    },
  };
}

function brokenLlm(): LlmPort {
  return {
    async structured() {
      throw new Error('модель недоступна');
    },
    async chat() {
      throw new Error('chat не нужен');
    },
  };
}

describe('вывод ИИ отчёта О3', () => {
  it('принимает текст, где все числа есть в фактах', async () => {
    const insight = await generateInsight(
      llmWith({ insight: 'В срок закрыто 75% заявок, просрочено 1 открытая.', actions: ['Разобрать З-0009.'] }),
      facts,
      templateInsight(result),
      request,
    );

    expect(insight.source).toBe('ai');
    expect(insight.model).toBe('fake-cheap');
    expect(insight.meaning).toContain('75');
  });

  it('выдуманное число заменяет вывод шаблоном', async () => {
    const insight = await generateInsight(
      llmWith({ insight: 'Потеряли 999 часов.', actions: ['Разобрать просрочки.'] }),
      facts,
      templateInsight(result),
      request,
    );

    expect(insight.source).toBe('template');
    expect(insight.meaning).toContain('Закрыто');
  });

  it('ошибка модели даёт шаблон, а не пустой блок', async () => {
    const insight = await generateInsight(brokenLlm(), facts, templateInsight(result), request);

    expect(insight).toMatchObject({ source: 'template', model: null });
    expect(insight.actions.length).toBeGreaterThan(0);
  });

  it('разрешает число из подписи факта и запрещает чужое', () => {
    const allowed = allowedNumbers(facts);
    expect(onlyFactNumbers('Худшая заявка — просрочка 1440 мин.', allowed)).toBe(true);
    expect(onlyFactNumbers('Это 12345 заявок.', allowed)).toBe(false);
  });

  it('шаблон честно говорит, что данных нет', () => {
    const empty = templateInsight({
      ...result,
      summary: { ...result.summary, total: 0, closed: 0, open: 0 },
      byPriority: [],
      byDepartment: [],
      worst: [],
    });
    expect(empty.source).toBe('template');
    expect(empty.meaning).toContain('заявок нет');
  });
});
