import { describe, expect, it } from 'vitest';
import type { LlmPort, LlmRequest, LlmResult } from '@ugra/core';
import type { KbGapsResult } from '../contracts';
import { allowedNumbers, generateInsight, onlyFactNumbers, templateInsight } from '../server/insight';
import { factsOf } from '../server';

const result: KbGapsResult = {
  period: { from: '2026-10-15T12:00:00.000Z', to: '2026-11-14T12:00:00.000Z', days: 30 },
  filters: {},
  summary: {
    total: 40,
    analyzed: 25,
    withArticle: 17,
    withoutArticle: 23,
    shareWithoutArticlePercent: 57.5,
    themes: 3,
    fromJournal: 15,
    fromKnowledgeBase: 10,
  },
  themes: [
    {
      key: 'theme:network:vpn не подключается',
      label: 'VPN не подключается',
      symptom: 'VPN не подключается',
      category: 'network',
      categoryLabel: 'Сеть и связь',
      count: 23,
      sharePercent: 100,
      exampleTicketId: 't-1',
      exampleNumber: 'З-0001',
    },
    {
      key: 'theme:printer:пустые страницы',
      label: 'Пустые страницы',
      symptom: 'Пустые страницы',
      category: 'printer',
      categoryLabel: 'Принтер и печать',
      count: 8,
      sharePercent: 34.8,
      exampleTicketId: 't-2',
      exampleNumber: 'З-0002',
    },
  ],
  byCategory: [
    {
      category: 'network',
      label: 'Сеть и связь',
      total: 25,
      withoutArticle: 23,
      sharePercent: 92,
      topSymptom: 'VPN не подключается',
    },
  ],
};

const facts = factsOf(result);
const request = {
  title: 'Пробелы базы знаний',
  question: 'Каких статей не хватает?',
  promptId: 'modules/report-kb-gaps/prompts/insight.v1.md',
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

describe('вывод ИИ отчёта О6', () => {
  it('принимает текст, где все числа есть в фактах', async () => {
    const insight = await generateInsight(
      llmWith({
        insight: 'Из 40 заявок 23 остались без статьи, чаще всего не хватает темы VPN.',
        actions: ['Написать статью про VPN.'],
      }),
      facts,
      templateInsight(result),
      request,
    );

    expect(insight.source).toBe('ai');
    expect(insight.model).toBe('fake-cheap');
    expect(insight.meaning).toContain('40');
  });

  it('выдуманное число заменяет вывод шаблоном', async () => {
    const insight = await generateInsight(
      llmWith({ insight: 'Сэкономим 999 часов.', actions: ['Написать статью.'] }),
      facts,
      templateInsight(result),
      request,
    );

    expect(insight.source).toBe('template');
    expect(insight.meaning).toContain('без подходящей статьи');
  });

  it('ошибка модели даёт шаблон, а не пустой блок', async () => {
    const insight = await generateInsight(brokenLlm(), facts, templateInsight(result), request);

    expect(insight).toMatchObject({ source: 'template', model: null });
    expect(insight.actions.length).toBeGreaterThan(0);
  });

  it('разрешает числа из подписей фактов и запрещает чужие', () => {
    const allowed = allowedNumbers(facts);
    expect(onlyFactNumbers('Тема закрывает 23 обращения.', allowed)).toBe(true);
    expect(onlyFactNumbers('Нужно 1010 статей.', allowed)).toBe(false);
  });

  it('шаблон честно говорит, что данных нет', () => {
    const empty = templateInsight({
      ...result,
      summary: { ...result.summary, total: 0, withoutArticle: 0 },
      themes: [],
      byCategory: [],
    });
    expect(empty.source).toBe('template');
    expect(empty.meaning).toContain('заявок нет');
  });
});
