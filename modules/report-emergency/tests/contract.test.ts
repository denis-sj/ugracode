import { describe, expect, it } from 'vitest';
import { assertModuleContract } from '@ugra/testkit';
import reportEmergency, { emergencyReport, factsOf } from '../server';

describe('контракт модуля report-emergency', () => {
  it('проходит тест-контракт и объявляет отчёт О7', async () => {
    await assertModuleContract(reportEmergency);
    expect(reportEmergency.reports).toHaveLength(1);
    expect(emergencyReport.id).toBe('emergency.summary');
    expect(emergencyReport.params.safeParse({ days: 30 }).success).toBe(true);
    expect(emergencyReport.params.safeParse({ days: 0 }).success).toBe(false);
    expect(emergencyReport.insightPromptId).toBe('modules/report-emergency/prompts/insight.v1.md');
  });

  it('факты непустые и числа совпадают с результатом', async () => {
    const result = await emergencyReport.compute(
      { days: 30 },
      {
        db: { listTickets: async () => [], listEvents: async () => [], getTicketFields: async () => [] },
        data: undefined,
        clock: { now: () => new Date() },
      },
    );
    const facts = factsOf(result);
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.every((fact) => String(fact.value).trim() !== '')).toBe(true);
    expect(facts.find((fact) => fact.label === 'Аварий')?.value).toBe(result.summary.emergency);
    expect(facts.find((fact) => fact.label === 'Период, дней')?.value).toBe(result.period.days);
  });
});
