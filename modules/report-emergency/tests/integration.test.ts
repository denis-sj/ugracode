import { describe, expect, it } from 'vitest';
import { createReferenceData, MemoryStore } from '@ugra/core';
import historySeed from '../../history-seed/server';
import { EmergencyResult } from '../contracts';
import { computeEmergency } from '../server/compute';

const clock = { now: () => new Date('2026-11-14T12:00:00.000Z') };

/** Сквозная проверка демо: история из сида → О7 на тех же данных. */
describe('история и аварии вместе', () => {
  it('находит три аварии истории и валидный результат', async () => {
    const store = new MemoryStore();
    const data = createReferenceData();
    await historySeed.seed?.({ db: store, data, clock });

    const result = await computeEmergency({ days: 200 }, { db: store, data, clock });

    expect(result.summary.total).toBeGreaterThan(500);
    expect(result.summary.emergency).toBe(3);
    expect(result.summary.closed).toBe(3);
    expect(result.summary.reactionMeasured).toBe(0);
    expect(result.summary.falseAlarms).toBeNull();
    expect(result.recent).toHaveLength(3);
    expect(() => EmergencyResult.parse(result)).not.toThrow();
  });
});
