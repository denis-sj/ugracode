import { describe, expect, it } from 'vitest';
import type { OverviewResult } from '../contracts';
import { openStatuses } from '../web/format';

/** Плитка «Сейчас в работе»: труба из ячеек показывает только открытые статусы. */

function overview(byStatus: { key: string; count: number }[]): OverviewResult {
  return {
    byStatus: byStatus.map((slice) => ({ ...slice, label: slice.key })),
  } as unknown as OverviewResult;
}

describe('openStatuses', () => {
  it('оставляет только открытые статусы с ненулевым числом', () => {
    const rows = openStatuses(
      overview([
        { key: 'new', count: 2 },
        { key: 'in_progress', count: 3 },
        { key: 'closed', count: 10 },
        { key: 'assigned', count: 0 },
      ]),
    );
    expect(rows.map((row) => row.key)).toEqual(['new', 'in_progress']);
    expect(rows[0]?.label).toBe('Новые');
  });

  it('на пустых данных отдаёт пустой список, а не падает', () => {
    expect(openStatuses(overview([]))).toEqual([]);
  });
});
