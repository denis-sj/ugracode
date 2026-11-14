import { describe, expect, it } from 'vitest';
import { assertModuleContract } from '@ugra/testkit';
import reportsDashboard, { overviewReport } from '../server';

describe('контракт модуля reports-dashboard', () => {
  it('проходит тест-контракт и объявляет отчёт О0', async () => {
    await assertModuleContract(reportsDashboard);
    expect(reportsDashboard.reports).toHaveLength(1);
    expect(overviewReport.id).toBe('dashboard.overview');
    expect(overviewReport.params.safeParse({ days: 30 }).success).toBe(true);
    expect(overviewReport.params.safeParse({ days: 0 }).success).toBe(false);
  });
});
