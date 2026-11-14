import { describe, expect, it } from 'vitest';
import { assertModuleContract } from '@ugra/testkit';
import reportHotspots, { factsOf, hotspotsReport } from '../server';

describe('контракт модуля report-hotspots', () => {
  it('проходит тест-контракт и объявляет отчёт О2', async () => {
    await assertModuleContract(reportHotspots);
    expect(reportHotspots.reports).toHaveLength(1);
    expect(hotspotsReport.id).toBe('hotspots.equipment');
    expect(hotspotsReport.params.safeParse({ days: 30 }).success).toBe(true);
    expect(hotspotsReport.params.safeParse({ days: 0 }).success).toBe(false);
    expect(hotspotsReport.insightPromptId).toBe('modules/report-hotspots/prompts/insight.v1.md');
  });

  it('факты непустые и числа совпадают с результатом', async () => {
    const result = await hotspotsReport.compute(
      { days: 30 },
      { db: { listTickets: async () => [], listEvents: async () => [] }, data: undefined, clock: { now: () => new Date() } },
    );
    const facts = factsOf(result);
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.every((fact) => String(fact.value).trim() !== '')).toBe(true);
    expect(facts.find((fact) => fact.label === 'Заявок за период')?.value).toBe(result.total);
    expect(facts.find((fact) => fact.label === 'Период, дней')?.value).toBe(result.period.days);
  });
});
