import { describe, expect, it } from 'vitest';
import { assertModuleContract } from '@ugra/testkit';
import reportKbGaps, { factsOf, kbGapsReport, MISS_EVENT } from '../server';

describe('контракт модуля report-kb-gaps', () => {
  it('проходит тест-контракт и объявляет отчёт О6', async () => {
    await assertModuleContract(reportKbGaps);
    expect(reportKbGaps.reports).toHaveLength(1);
    expect(kbGapsReport.id).toBe('kb-gaps.articles');
    expect(kbGapsReport.params.safeParse({ days: 30 }).success).toBe(true);
    expect(kbGapsReport.params.safeParse({ days: 0 }).success).toBe(false);
    expect(kbGapsReport.insightPromptId).toBe('modules/report-kb-gaps/prompts/insight.v1.md');
    expect(reportKbGaps.events.map((event) => event.type)).toContain(MISS_EVENT);
    expect(reportKbGaps.subscribers.map((subscriber) => subscriber.on)).toContain(
      'analysis.completed',
    );
  });

  it('факты непустые и числа совпадают с результатом', async () => {
    const result = await kbGapsReport.compute(
      { days: 30 },
      {
        db: {
          listTickets: async () => [],
          listEvents: async () => [],
          getTicketFields: async () => [],
          searchKnowledge: async () => [],
        },
        data: undefined,
        clock: { now: () => new Date() },
      },
    );
    const facts = factsOf(result);
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.every((fact) => String(fact.value).trim() !== '')).toBe(true);
    expect(facts.find((fact) => fact.label === 'Заявок за период')?.value).toBe(result.summary.total);
    expect(facts.find((fact) => fact.label === 'Период, дней')?.value).toBe(result.period.days);
  });
});
