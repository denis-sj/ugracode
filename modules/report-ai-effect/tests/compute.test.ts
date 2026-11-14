import { describe, expect, it } from 'vitest';
import type { DomainEvent } from '@ugra/contracts';
import { createReferenceData, MemoryStore } from '@ugra/core';
import { AiEffectResult } from '../contracts';
import { computeAiEffect } from '../server/compute';

const NOW = new Date(2026, 10, 14, 12, 0, 0);
const clock = { now: () => NOW };

function at(hoursAgo: number): string {
  return new Date(NOW.getTime() - hoursAgo * 60 * 60 * 1000).toISOString();
}

function event(
  id: string,
  type: string,
  ticketId: string,
  hoursAgo: number,
  payload: Record<string, unknown>,
): DomainEvent {
  return { id, type, at: at(hoursAgo), actor: { kind: type === 'ticket.confirmed' ? 'user' : 'ai' }, ticketId, payload };
}

function fieldSet(id: string, ticketId: string, fieldKey: string, hoursAgo: number): DomainEvent {
  return event(id, 'ticket.field.set', ticketId, hoursAgo, { fieldKey, value: 'x', origin: 'text' });
}

function corrected(id: string, ticketId: string, fieldKey: string, hoursAgo: number): DomainEvent {
  return event(id, 'ticket.field.corrected', ticketId, hoursAgo, {
    fieldKey,
    value: 'y',
    previous: 'x',
  });
}

async function storeWith(events: DomainEvent[]): Promise<MemoryStore> {
  const store = new MemoryStore();
  for (const item of events) await store.appendEvent(item);
  return store;
}

describe('computeAiEffect', () => {
  it('на пустом журнале честно отдаёт null и не выдумывает сравнение', async () => {
    const result = await computeAiEffect(
      { days: 30 },
      { db: new MemoryStore(), data: createReferenceData(), clock },
    );

    expect(result.totals).toMatchObject({
      ticketsWithAi: 0,
      fieldsSuggested: 0,
      fieldsCorrected: 0,
      shareWithoutEditsPercent: null,
      avgCorrectionsPerTicket: null,
      avgMinutesToConfirm: null,
      confirmedTickets: 0,
    });
    expect(result.comparison.withoutAi).toBeNull();
    expect(result.comparison.source).toBe('none');
    expect(() => AiEffectResult.parse(result)).not.toThrow();
  });

  it('считает долю без правок, среднее число правок и время до подтверждения', async () => {
    const store = await storeWith([
      fieldSet('e-1', 't-1', 'cabinet', 3),
      fieldSet('e-2', 't-1', 'equipment', 3),
      corrected('e-3', 't-1', 'cabinet', 2),
      event('e-4', 'ticket.confirmed', 't-1', 1.5, { assigneeId: 'u-engineer-2' }),
    ]);

    const result = await computeAiEffect(
      { days: 30 },
      { db: store, data: createReferenceData(), clock },
    );

    expect(result.totals.ticketsWithAi).toBe(1);
    expect(result.totals.fieldsSuggested).toBe(2);
    expect(result.totals.fieldsCorrected).toBe(1);
    expect(result.totals.ticketsWithoutEdits).toBe(0);
    expect(result.totals.shareWithoutEditsPercent).toBe(0);
    expect(result.totals.avgCorrectionsPerTicket).toBe(1);
    expect(result.totals.confirmedTickets).toBe(1);
    expect(result.totals.avgMinutesToConfirm).toBe(90);
    expect(result.totals.correctionsByField[0]).toMatchObject({
      fieldKey: 'cabinet',
      corrections: 1,
      suggestions: 1,
    });
    expect(result.comparison.withAi.avgMinutesToConfirm).toBe(90);
    expect(result.comparison.withoutAi).toBeNull();
  });

  it('считает заявки без правок и не берёт события вне периода', async () => {
    const store = await storeWith([
      fieldSet('e-1', 't-1', 'cabinet', 3),
      fieldSet('e-2', 't-2', 'cabinet', 4),
      corrected('e-3', 't-1', 'cabinet', 2),
      fieldSet('old', 't-9', 'cabinet', 24 * 40),
      corrected('old-c', 't-9', 'cabinet', 24 * 39),
    ]);

    const result = await computeAiEffect(
      { days: 30 },
      { db: store, data: createReferenceData(), clock },
    );

    expect(result.totals.ticketsWithAi).toBe(2);
    expect(result.totals.ticketsWithoutEdits).toBe(1);
    expect(result.totals.shareWithoutEditsPercent).toBe(50);
    expect(result.totals.fieldsCorrected).toBe(1);
  });

  it('без подтверждений не считает время и оставляет сравнение пустым', async () => {
    const store = await storeWith([fieldSet('e-1', 't-1', 'cabinet', 2)]);
    const result = await computeAiEffect(
      { days: 7 },
      { db: store, data: createReferenceData(), clock },
    );

    expect(result.totals.avgMinutesToConfirm).toBeNull();
    expect(result.totals.confirmedTickets).toBe(0);
    expect(result.comparison.withAi.avgMinutesToConfirm).toBeNull();
    expect(result.comparison.withoutAi).toBeNull();
    expect(result.comparison.note).toContain('ручным режимом');
  });
});
