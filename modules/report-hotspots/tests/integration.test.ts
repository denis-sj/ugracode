import { describe, expect, it } from 'vitest';
import { createReferenceData, MemoryStore } from '@ugra/core';
import historySeed from '../../history-seed/server';
import { computeHotspots } from '../server/compute';

const clock = { now: () => new Date('2026-11-14T12:00:00.000Z') };

/** Сквозная проверка демо: история из сида → отчёт О2 по тем же данным. */
describe('история и горячие точки вместе', () => {
  it('находит принтер в кабинете 312 среди повторов', async () => {
    const store = new MemoryStore();
    const data = createReferenceData();
    await historySeed.seed?.({ db: store, data, clock });

    const result = await computeHotspots({ days: 200 }, { db: store, data, clock });

    expect(result.total).toBe(600);
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows[0]?.cabinet).toBe('312');
    expect(result.rows[0]?.count).toBeGreaterThanOrEqual(6);
    expect(result.repeatedTickets).toBeGreaterThanOrEqual(6);
  });
});
