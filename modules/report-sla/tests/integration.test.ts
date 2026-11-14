import { describe, expect, it } from 'vitest';
import { createReferenceData, MemoryStore } from '@ugra/core';
import historySeed from '../../history-seed/server';
import { SlaResult } from '../contracts';
import { computeSla } from '../server/compute';

const clock = { now: () => new Date('2026-11-14T12:00:00.000Z') };

/** Сквозная проверка демо: история из сида → О3 по тем же данным. */
describe('история и сроки вместе', () => {
  it('считает SLA по 600 заявкам истории и отдаёт валидный результат', async () => {
    const store = new MemoryStore();
    const data = createReferenceData();
    await historySeed.seed?.({ db: store, data, clock });

    const result = await computeSla({ days: 200 }, { db: store, data, clock });

    expect(result.summary.total).toBeGreaterThan(500);
    expect(result.summary.closed).toBeGreaterThan(0);
    expect(result.summary.avgResolutionMinutes).not.toBeNull();
    expect(result.summary.lateClosed).toBeGreaterThanOrEqual(0);
    expect(result.byPriority.length).toBeGreaterThan(0);
    expect(result.byDepartment.length).toBeGreaterThan(0);
    // История почти без назначений: реакция известна только там, где есть переход в «назначена».
    expect(result.summary.reactionMeasured).toBeGreaterThan(0);
    expect(() => SlaResult.parse(result)).not.toThrow();
  });
});
