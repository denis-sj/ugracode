import { describe, expect, it } from 'vitest';
import { createReferenceData, MemoryStore } from '@ugra/core';
import historySeed from '../server';

const clock = { now: () => new Date('2026-11-14T12:00:00.000Z') };

describe('history-seed', () => {
  it('пишет историю через KernelStore и не дублирует её вторым запуском', async () => {
    const store = new MemoryStore();
    const deps = { db: store, data: createReferenceData(), clock };

    await historySeed.seed?.(deps);
    const first = await store.listTickets({ limit: 2000 });
    expect(first.length).toBe(600);

    await historySeed.seed?.(deps);
    const second = await store.listTickets({ limit: 2000 });
    expect(second.length).toBe(600);

    const events = await store.listEvents({ limit: 2000 });
    expect(events.length).toBe(600);
    expect(events.every((event) => event.type === 'ticket.status.changed')).toBe(true);

    const sample = first[0];
    expect(sample).toBeDefined();
    if (!sample) return;
    expect(await store.getAppeal(sample.appealId)).not.toBeNull();
    expect((await store.getTicketFields(sample.id)).length).toBeGreaterThanOrEqual(2);
  });
});
