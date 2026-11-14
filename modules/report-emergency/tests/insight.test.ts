import { describe, expect, it } from 'vitest';
import type { LlmPort, LlmRequest, LlmResult } from '@ugra/core';
import type { EmergencyResult } from '../contracts';
import { allowedNumbers, generateInsight, onlyFactNumbers, templateInsight } from '../server/insight';
import { factsOf } from '../server';

const result: EmergencyResult = {
  period: { from: '2026-10-15T12:00:00.000Z', to: '2026-11-14T12:00:00.000Z', days: 30 },
  filters: {},
  summary: {
    total: 60,
    emergency: 6,
    sharePercent: 10,
    closed: 5,
    open: 1,
    reactionMeasured: 4,
    avgReactionMinutes: 12,
    repeatedHotspots: 1,
    detectedSignals: 9,
    suspectedSignals: 3,
    falseAlarms: 3,
  },
  hotspots: [
    {
      key: 'eq:switch-1',
      kind: 'equipment',
      equipmentId: 'switch-1',
      locationId: 'cab-b-210',
      label: 'Коммутатор Cisco · Корпус Б · каб. 210',
      count: 2,
      sharePercent: 33.3,
      lastAt: '2026-11-10T09:00:00.000Z',
    },
  ],
  recent: [
    {
      id: 't-1',
      number: 'З-0001',
      createdAt: '2026-11-13T09:00:00.000Z',
      status: 'closed',
      priority: 'emergency',
      equipmentId: 'switch-1',
      locationId: 'cab-b-210',
    },
  ],
};

const facts = factsOf(result);
const request = {
  title: 'Аварии',
  question: 'Где повторяются аварии?',
  promptId: 'modules/report-emergency/prompts/insight.v1.md',
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

describe('вывод ИИ отчёта О7', () => {
  it('принимает текст, где все числа есть в фактах', async () => {
    const insight = await generateInsight(
      llmWith({
        insight: 'За период 6 аварий, 2 из них в одной точке.',
        actions: ['Осмотреть коммутатор в кабинете 210.'],
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
      llmWith({ insight: 'Пожарных выездов было 999.', actions: ['Проверить регламент.'] }),
      facts,
      templateInsight(result),
      request,
    );

    expect(insight.source).toBe('template');
    expect(insight.meaning).toContain('аварий');
  });

  it('ошибка модели даёт шаблон, а не пустой блок', async () => {
    const insight = await generateInsight(brokenLlm(), facts, templateInsight(result), request);

    expect(insight).toMatchObject({ source: 'template', model: null });
    expect(insight.actions.length).toBeGreaterThan(0);
  });

  it('разрешает числа из фактов и запрещает чужие', () => {
    const allowed = allowedNumbers(facts);
    expect(onlyFactNumbers('Всего 6 аварий при 9 сигналах.', allowed)).toBe(true);
    expect(onlyFactNumbers('Это 555 выездов.', allowed)).toBe(false);
  });

  it('шаблон честно говорит, что данных нет', () => {
    const empty = templateInsight({
      ...result,
      summary: {
        ...result.summary,
        total: 0,
        emergency: 0,
        closed: 0,
        open: 0,
        avgReactionMinutes: null,
      },
      hotspots: [],
      recent: [],
    });
    expect(empty.source).toBe('template');
    expect(empty.meaning).toContain('заявок нет');
  });
});
