import { describe, expect, it } from 'vitest';
import type { LlmPort, LlmRequest, LlmResult } from '@ugra/core';
import type { HotspotsResult } from '../contracts';
import { allowedNumbers, generateInsight, onlyFactNumbers, templateInsight } from '../server/insight';
import { factsOf } from '../server';

const result: HotspotsResult = {
  period: { from: '2026-10-15T00:00:00.000Z', to: '2026-11-14T00:00:00.000Z', days: 30 },
  previousPeriod: { from: '2026-09-15T00:00:00.000Z', to: '2026-10-14T00:00:00.000Z', days: 30 },
  filters: {},
  total: 5,
  previousTotal: 4,
  trendPercent: 25,
  repeatedTickets: 3,
  rows: [
    {
      key: 'eq:b312',
      kind: 'equipment',
      equipmentId: 'eq-b312',
      label: 'HP LaserJet · Корпус Б · каб. 312',
      building: 'Б',
      cabinet: '312',
      category: 'printer',
      count: 3,
      sharePercent: 60,
      avgResolutionMinutes: 90,
      previousCount: 2,
      trendPercent: 50,
    },
  ],
};

const facts = factsOf(result);
const request = {
  title: 'Горячие точки',
  question: 'Где ломается снова?',
  promptId: 'modules/report-hotspots/prompts/insight.v1.md',
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

describe('вывод ИИ отчёта О2', () => {
  it('принимает текст, где все числа есть в фактах', async () => {
    const insight = await generateInsight(
      llmWith({ insight: 'За 5 заявок точка набрала 3 обращения.', actions: ['Проверить кабинет 312.'] }),
      facts,
      templateInsight(result),
      request,
    );

    expect(insight.source).toBe('ai');
    expect(insight.model).toBe('fake-cheap');
    expect(insight.meaning).toContain('5');
  });

  it('выдуманное число заменяет вывод шаблоном', async () => {
    const insight = await generateInsight(
      llmWith({ insight: 'Экономия составила 999 рублей.', actions: ['Проверить технику.'] }),
      facts,
      templateInsight(result),
      request,
    );

    expect(insight.source).toBe('template');
    expect(insight.meaning).toContain('Главная точка');
  });

  it('ошибка модели даёт шаблон, а не пустой блок', async () => {
    const insight = await generateInsight(brokenLlm(), facts, templateInsight(result), request);

    expect(insight).toMatchObject({ source: 'template', model: null });
    expect(insight.actions.length).toBeGreaterThan(0);
  });

  it('видит числа из подписей фактов и не видит чужих', () => {
    const allowed = allowedNumbers(facts);
    expect(onlyFactNumbers('Точка набрала 3 обращения при доле 60%.', allowed)).toBe(true);
    expect(onlyFactNumbers('Это 12345 обращений.', allowed)).toBe(false);
  });

  it('шаблон честно говорит, что данных нет', () => {
    const empty = templateInsight({ ...result, total: 0, rows: [], repeatedTickets: 0 });
    expect(empty.source).toBe('template');
    expect(empty.meaning).toContain('нет');
  });
});
