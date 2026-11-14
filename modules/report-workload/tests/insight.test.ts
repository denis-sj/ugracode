import { describe, expect, it } from 'vitest';
import type { LlmPort, LlmRequest, LlmResult } from '@ugra/core';
import type { WorkloadResult } from '../contracts';
import { allowedNumbers, generateInsight, onlyFactNumbers, templateInsight } from '../server/insight';
import { factsOf } from '../server';

const result: WorkloadResult = {
  period: { from: '2026-10-15T12:00:00.000Z', to: '2026-11-14T12:00:00.000Z', days: 30 },
  filters: {},
  summary: {
    totalOpen: 12,
    totalClosed: 40,
    engineers: 4,
    overloaded: 2,
    avgOpenPerEngineer: 3,
    avgResolutionMinutes: 220,
    overloadThreshold: 5,
  },
  byEngineer: [
    {
      assigneeId: 'u-engineer-2',
      name: 'Артём Кузнецов',
      departmentId: 'dep-it',
      departmentLabel: 'Рабочие места и периферия',
      open: 8,
      closed: 14,
      total: 22,
      avgResolutionMinutes: 200,
      overload: true,
    },
    {
      assigneeId: 'u-engineer-3',
      name: 'Марина Соловьёва',
      departmentId: 'dep-it',
      departmentLabel: 'Рабочие места и периферия',
      open: 1,
      closed: 10,
      total: 11,
      avgResolutionMinutes: 180,
      overload: false,
    },
  ],
  byDepartment: [
    {
      departmentId: 'dep-it',
      label: 'Рабочие места и периферия',
      engineers: 2,
      open: 9,
      closed: 24,
      openSharePercent: 75,
      avgOpenPerEngineer: 4.5,
      overloadedEngineers: 1,
    },
  ],
};

const facts = factsOf(result);
const request = {
  title: 'Нагрузка',
  question: 'Кого разгрузить?',
  promptId: 'modules/report-workload/prompts/insight.v1.md',
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

describe('вывод ИИ отчёта О4', () => {
  it('принимает текст, где все числа есть в фактах', async () => {
    const insight = await generateInsight(
      llmWith({
        insight: 'Открыто 12 заявок на 4 инженеров, перегружено 2.',
        actions: ['Передать заявки Марине Соловьёвой: у неё 1 открытая.'],
      }),
      facts,
      templateInsight(result),
      request,
    );

    expect(insight.source).toBe('ai');
    expect(insight.model).toBe('fake-cheap');
  });

  it('выдуманное число заменяет вывод шаблоном', async () => {
    const insight = await generateInsight(
      llmWith({ insight: 'Нужно 999 инженеров.', actions: ['Нанять людей.'] }),
      facts,
      templateInsight(result),
      request,
    );

    expect(insight.source).toBe('template');
    expect(insight.meaning).toContain('открыто');
  });

  it('ошибка модели даёт шаблон, а не пустой блок', async () => {
    const insight = await generateInsight(brokenLlm(), facts, templateInsight(result), request);

    expect(insight).toMatchObject({ source: 'template', model: null });
    expect(insight.actions.length).toBeGreaterThan(0);
  });

  it('разрешает числа из фактов и запрещает чужие', () => {
    const allowed = allowedNumbers(facts);
    expect(onlyFactNumbers('Перегружено 2 из 4.', allowed)).toBe(true);
    expect(onlyFactNumbers('Это 777 заявок.', allowed)).toBe(false);
  });

  it('шаблон честно говорит, что данных нет', () => {
    const empty = templateInsight({
      ...result,
      summary: { ...result.summary, totalOpen: 0, totalClosed: 0 },
      byEngineer: [],
      byDepartment: [],
    });
    expect(empty.source).toBe('template');
    expect(empty.meaning).toContain('заявок нет');
  });
});
