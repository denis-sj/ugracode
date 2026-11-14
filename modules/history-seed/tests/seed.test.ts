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
    // 600 событий статуса + 4 демо-правки диспетчера для журнала и метрики «ИИ без правок».
    const corrections = events.filter((event) => event.type === 'ticket.field.corrected');
    const statuses = events.filter((event) => event.type === 'ticket.status.changed');
    expect(statuses.length).toBe(600);
    expect(corrections.length).toBe(4);
    expect(events.length).toBe(604);

    const sample = first[0];
    expect(sample).toBeDefined();
    if (!sample) return;
    expect(await store.getAppeal(sample.appealId)).not.toBeNull();
    expect((await store.getTicketFields(sample.id)).length).toBeGreaterThanOrEqual(2);
  });

  it('демо-правка меняет поле на человеческое значение и оставляет вариант ИИ', async () => {
    const store = new MemoryStore();
    await historySeed.seed?.({ db: store, data: createReferenceData(), clock });

    const corrections = (await store.listEvents({ limit: 2000 })).filter(
      (event) => event.type === 'ticket.field.corrected',
    );
    const cabinet = corrections.find(
      (event) => (event.payload as { fieldKey?: string }).fieldKey === 'cabinet',
    );
    expect(cabinet).toBeDefined();
    expect(cabinet?.ticketId).toBeTruthy();
    const payload = cabinet?.payload as { value: string; previous: string };
    expect(payload.previous).toBe('312');
    expect(payload.value).toBe('313');

    const fields = await store.getTicketFields(cabinet?.ticketId ?? '');
    const field = fields.find((candidate) => candidate.fieldKey === 'cabinet');
    expect(field?.origin).toBe('human');
    expect(field?.aiValue).toBe('312');
    expect(field?.value).toBe('313');
  });
});
