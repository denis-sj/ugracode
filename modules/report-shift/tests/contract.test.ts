import { describe, expect, it } from 'vitest';
import { MemoryStore } from '@ugra/core';
import { assertModuleContract } from '@ugra/testkit';
import reportShift, { factsOf, shiftReport } from '../server';
import { computeShift } from '../server/compute';

const clock = { now: () => new Date(2026, 10, 14, 18, 0, 0) };

describe('контракт модуля report-shift', () => {
  it('проходит тест-контракт и объявляет отчёт О1', async () => {
    await assertModuleContract(reportShift);
    expect(reportShift.reports).toHaveLength(1);
    expect(shiftReport.id).toBe('shift.summary');
    expect(shiftReport.params.safeParse({ date: '2026-11-14' }).success).toBe(true);
    expect(shiftReport.params.safeParse({ date: '14.11.2026' }).success).toBe(false);
    expect(shiftReport.insightPromptId).toBe('modules/report-shift/prompts/insight.v1.md');
  });

  it('факты непустые и числа совпадают с результатом', async () => {
    const result = await computeShift({ date: '2026-11-14' }, { db: new MemoryStore(), clock });
    const facts = factsOf(result);
    expect(facts.length).toBeGreaterThan(0);
    expect(facts.every((fact) => String(fact.value).trim() !== '')).toBe(true);
    expect(facts.find((fact) => fact.label === 'Дата смены')?.value).toBe(result.period.date);
    expect(facts.find((fact) => fact.label === 'Всего заявок')?.value).toBe(result.totals.total);
  });
});
