import { describe, expect, it } from 'vitest';
import type { Ticket } from '@ugra/contracts';
import { MemoryStore } from '@ugra/core';
import { ShiftResult } from '../contracts';
import { computeShift } from '../server/compute';

const clock = { now: () => new Date(2026, 10, 14, 18, 0, 0) };

function at(day: number, hour: number, minute = 0): string {
  return new Date(2026, 10, day, hour, minute, 0).toISOString();
}

function makeTicket(id: string, overrides: Partial<Ticket> = {}): Ticket {
  return {
    id,
    number: `З-${id}`,
    appealId: `appeal-${id}`,
    status: 'closed',
    priority: 'medium',
    category: 'printer',
    departmentId: 'dep-it',
    assigneeId: 'u-engineer-2',
    isEmergency: false,
    incidentId: null,
    reactDueAt: at(14, 9),
    slaDueAt: at(14, 12),
    equipmentId: 'eq-b312',
    locationId: 'cab-b-312',
    confirmedBy: null,
    confirmedAt: null,
    createdAt: at(14, 9),
    updatedAt: at(14, 11),
    ...overrides,
  };
}

async function storeWith(tickets: Ticket[]): Promise<MemoryStore> {
  const store = new MemoryStore();
  for (const ticket of tickets) await store.saveTicket(ticket);
  return store;
}

describe('computeShift', () => {
  it('на пустой смене отдаёт нули и пустое внимание', async () => {
    const result = await computeShift({ date: '2026-11-14' }, { db: new MemoryStore(), clock });

    expect(result.period.date).toBe('2026-11-14');
    expect(result.totals).toEqual({
      total: 0,
      created: 0,
      closed: 0,
      emergency: 0,
      slaBreaches: 0,
      slaOnTimePercent: null,
    });
    expect(result.byAssignee).toEqual([]);
    expect(result.attention.overdueCount).toBe(0);
    expect(result.attention.waitingReviewCount).toBe(0);
    expect(() => ShiftResult.parse(result)).not.toThrow();
  });

  it('считает итоги смены, срок и внимание', async () => {
    const store = await storeWith([
      makeTicket('t-1'),
      makeTicket('t-2', {
        isEmergency: true,
        priority: 'emergency',
        createdAt: at(14, 8),
        updatedAt: at(14, 10),
        slaDueAt: at(14, 9),
      }),
      makeTicket('t-3', {
        status: 'in_progress',
        assigneeId: 'u-engineer-1',
        createdAt: at(13, 15),
        updatedAt: at(14, 9),
        slaDueAt: at(14, 8),
      }),
      makeTicket('t-4', {
        status: 'in_review',
        assigneeId: null,
        createdAt: at(14, 10),
        updatedAt: at(14, 10),
        slaDueAt: null,
      }),
      makeTicket('t-5', {
        status: 'new',
        createdAt: at(14, 10),
        updatedAt: at(14, 10),
        slaDueAt: null,
      }),
      makeTicket('other-day', {
        createdAt: at(13, 10),
        updatedAt: at(13, 12),
      }),
    ]);

    const result = await computeShift({ date: '2026-11-14' }, { db: store, clock });

    expect(result.totals.total).toBe(5);
    expect(result.totals.created).toBe(4);
    expect(result.totals.closed).toBe(2);
    expect(result.totals.emergency).toBe(1);
    expect(result.totals.slaBreaches).toBe(1);
    expect(result.totals.slaOnTimePercent).toBe(50);
    expect(result.attention.overdueCount).toBe(1);
    expect(result.attention.overdue[0]?.number).toBe('З-t-3');
    expect(result.attention.waitingReviewCount).toBe(1);
    expect(result.attention.waitingReview[0]?.number).toBe('З-t-4');
    expect(result.byAssignee.find((row) => row.assigneeId === 'u-engineer-2')?.total).toBe(3);
    expect(result.byAssignee.find((row) => row.assigneeId === null)?.name).toBe('Не назначено');
  });

  it('берёт день из параметра, а по умолчанию — из часов ядра', async () => {
    const store = await storeWith([
      makeTicket('today'),
      makeTicket('yesterday', { createdAt: at(13, 10), updatedAt: at(13, 12) }),
    ]);

    const byParam = await computeShift({ date: '2026-11-13' }, { db: store, clock });
    const byDefault = await computeShift({}, { db: store, clock });

    expect(byParam.period.date).toBe('2026-11-13');
    expect(byParam.totals.total).toBe(1);
    expect(byDefault.period.date).toBe('2026-11-14');
    expect(byDefault.totals.total).toBe(1);
  });

  it('не падает на несуществующей дате и берёт сегодняшний день', async () => {
    const result = await computeShift({ date: '2026-13-45' }, { db: new MemoryStore(), clock });
    expect(result.period.date).toBe('2026-11-14');
  });
});
