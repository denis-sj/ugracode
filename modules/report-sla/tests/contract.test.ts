import { describe, expect, it } from 'vitest';
import { assertModuleContract } from '@ugra/testkit';
import reportSla, { factsOf, slaReport } from '../server';

describe('контракт модуля report-sla', () => {
  it('проходит тест-контракт и объявляет отчёт О3', async () => {
    await assertModuleContract(reportSla);
    expect(reportSla.reports).toHaveLength(1);
    expect(slaReport.id).toBe('sla.summary');
    expect(slaReport.params.safeParse({ days: 30, priority: 'high' }).success).toBe(true);
    expect(slaReport.params.safeParse({ days: 0 }).success).toBe(false);
    expect(slaReport.params.safeParse({ priority: 'urgent' }).success).toBe(false);
    expect(slaReport.insightPromptId).toBe('modules/report-sla/prompts/insight.v1.md');
  });

  it('факты непустые и числа совпадают с результатом', async () => {
    const result = await slaReport.compute(
      { days: 30 },
      {
        db: { listTickets: async () => [], listEvents: async () => [] },
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
