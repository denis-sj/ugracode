import { describe, expect, it } from 'vitest';
import { createReferenceData, MemoryStore } from '@ugra/core';
import historySeed from '../../history-seed/server';
import { factsOf } from '../server';
import { computeOverview } from '../server/overview';

const clock = { now: () => new Date('2026-11-14T12:00:00.000Z') };

/** Сквозная проверка демо: история из сида → отчёт О0 по тем же данным. */
describe('история и отчёт вместе', () => {
  it('считает О0 по 600 заявкам истории и находит кабинет 312', async () => {
    const store = new MemoryStore();
    const data = createReferenceData();
    await historySeed.seed?.({ db: store, data, clock });

    const result = await computeOverview({ days: 200 }, { db: store, data, clock });

    expect(result.totals.total).toBe(600);
    expect(result.totals.open + result.totals.closed + result.totals.cancelled).toBe(600);
    expect(result.totals.emergency).toBe(3);
    expect(result.avgResolutionMinutes).not.toBeNull();
    expect(result.hotSpots[0]?.cabinet).toBe('312');
    expect(result.hotSpots[0]?.count).toBeGreaterThanOrEqual(6);
    expect(result.byCategory.length).toBeGreaterThan(0);
    expect(result.insights.hotspots.action).toBeTruthy();
    expect(factsOf(result).every((fact) => String(fact.value).length > 0)).toBe(true);
  });
});
