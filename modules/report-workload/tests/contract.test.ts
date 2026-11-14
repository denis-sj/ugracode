import { describe, expect, it } from 'vitest';
import { assertModuleContract } from '@ugra/testkit';
import reportWorkload, { factsOf, workloadReport } from '../server';

describe('контракт модуля report-workload', () => {
  it('проходит тест-контракт и объявляет отчёт О4', async () => {
    await assertModuleContract(reportWorkload);
    expect(reportWorkload.reports).toHaveLength(1);
    expect(workloadReport.id).toBe('workload.load');
    expect(workloadReport.params.safeParse({ days: 30 }).success).toBe(true);
    expect(workloadReport.params.safeParse({ days: 0 }).success).toBe(false);
    expect(workloadReport.params.safeParse({ departmentId: '' }).success).toBe(false);
    expect(workloadReport.insightPromptId).toBe('modules/report-workload/prompts/insight.v1.md');
  });

  it('факты непустые и числа совпадают с результатом', async () => {
    const result = await workloadReport.compute(
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
    expect(facts.find((fact) => fact.label === 'Открытых заявок')?.value).toBe(
      result.summary.totalOpen,
    );
    expect(facts.find((fact) => fact.label === 'Период, дней')?.value).toBe(result.period.days);
  });
});
