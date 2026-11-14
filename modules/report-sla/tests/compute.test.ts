import { describe, expect, it } from 'vitest';
import type { DomainEvent, Ticket } from '@ugra/contracts';
import { createReferenceData, MemoryStore } from '@ugra/core';
import { SlaResult } from '../contracts';
import { computeSla } from '../server/compute';
import { factsOf } from '../server';

const NOW = new Date(2026, 10, 14, 12, 0, 0);
const clock = { now: () => NOW };
const DAY = 24 * 60 * 60 * 1000;
const MIN = 60 * 1000;

function daysAgo(days: number, minutes = 0): string {
  return new Date(NOW.getTime() - days * DAY - minutes * MIN).toISOString();
}

function makeTicket(id: string, overrides: Partial<Ticket> = {}): Ticket {
  const created = daysAgo(2);
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
    reactDueAt: new Date(Date.parse(created) + 60 * MIN).toISOString(),
    slaDueAt: new Date(Date.parse(created) + 240 * MIN).toISOString(),
    equipmentId: 'eq-b312',
    locationId: 'cab-b-312',
    confirmedBy: null,
    confirmedAt: null,
    createdAt: created,
    updatedAt: new Date(Date.parse(created) + 90 * MIN).toISOString(),
    ...overrides,
  };
}

function event(
  id: string,
  type: string,
  ticketId: string,
  at: string,
  payload: Record<string, unknown>,
): DomainEvent {
  return { id, type, at, actor: { kind: 'user', id: 'u-test' }, ticketId, payload };
}

function assigned(ticket: Ticket, minutes: number): DomainEvent {
  const at = new Date(Date.parse(ticket.createdAt) + minutes * MIN).toISOString();
  return event(`ev-${ticket.id}`, 'ticket.assigned', ticket.id, at, {
    assigneeId: ticket.assigneeId,
  });
}

function resolved(ticket: Ticket, minutes: number): DomainEvent {
  const at = new Date(Date.parse(ticket.createdAt) + minutes * MIN).toISOString();
  return event(`ev-${ticket.id}`, 'ticket.status.changed', ticket.id, at, {
    from: 'in_progress',
    to: 'closed',
    resolvedAt: at,
    resolutionMinutes: minutes,
  });
}

async function storeWith(tickets: Ticket[], events: DomainEvent[] = []): Promise<MemoryStore> {
  const store = new MemoryStore();
  for (const ticket of tickets) await store.saveTicket(ticket);
  for (const item of events) await store.appendEvent(item);
  return store;
}

describe('computeSla', () => {
  it('на пустой базе отдаёт нули и пустые разрезы', async () => {
    const result = await computeSla(
      { days: 30 },
      { db: new MemoryStore(), data: createReferenceData(), clock },
    );

    expect(result.summary.total).toBe(0);
    expect(result.summary.slaOnTimePercent).toBeNull();
    expect(result.summary.avgResolutionMinutes).toBeNull();
    expect(result.byPriority).toEqual([]);
    expect(result.byDepartment).toEqual([]);
    expect(result.worst).toEqual([]);
    expect(() => SlaResult.parse(result)).not.toThrow();
    expect(factsOf(result).length).toBeGreaterThan(0);
  });

  it('считает одну заявку: в срок, реакция и решение', async () => {
    const ticket = makeTicket('t-1');
    const store = await storeWith([ticket], [assigned(ticket, 30), resolved(ticket, 90)]);

    const result = await computeSla(
      { days: 30 },
      { db: store, data: createReferenceData(), clock },
    );

    expect(result.summary).toMatchObject({
      total: 1,
      closed: 1,
      open: 0,
      dueKnown: 1,
      onTimeClosed: 1,
      lateClosed: 0,
      openOverdue: 0,
      slaOnTimePercent: 100,
      reactionMeasured: 1,
      reactionKnown: 1,
      reactionOnTime: 1,
      avgReactionMinutes: 30,
      avgResolutionMinutes: 90,
    });
    expect(result.byPriority).toHaveLength(1);
    expect(result.byPriority[0]).toMatchObject({ priority: 'medium', total: 1, onTimePercent: 100 });
    expect(result.byDepartment[0]).toMatchObject({ departmentId: 'dep-it', total: 1 });
  });

  it('не берёт заявки вне периода', async () => {
    const store = await storeWith([
      makeTicket('fresh'),
      makeTicket('old', { createdAt: daysAgo(90), updatedAt: daysAgo(90) }),
    ]);

    const result = await computeSla(
      { days: 30 },
      { db: store, data: createReferenceData(), clock },
    );

    expect(result.summary.total).toBe(1);
  });

  it('считает просрочку закрытых и открытых, отмену и риск', async () => {
    const late = makeTicket('late', {
      priority: 'critical',
      departmentId: 'dep-network',
      createdAt: daysAgo(5),
      slaDueAt: new Date(Date.parse(daysAgo(5)) + 60 * MIN).toISOString(),
      updatedAt: new Date(Date.parse(daysAgo(5)) + 180 * MIN).toISOString(),
    });
    const overdue = makeTicket('overdue', {
      status: 'assigned',
      priority: 'high',
      departmentId: 'dep-network',
      createdAt: daysAgo(3),
      slaDueAt: new Date(Date.parse(daysAgo(3)) + 60 * MIN).toISOString(),
    });
    const risk = makeTicket('risk', {
      status: 'in_progress',
      priority: 'low',
      createdAt: new Date(NOW.getTime() - 60 * MIN).toISOString(),
      slaDueAt: new Date(NOW.getTime() + 120 * MIN).toISOString(),
    });
    const cancelled = makeTicket('cancelled', { status: 'cancelled', priority: 'low' });
    const store = await storeWith(
      [late, overdue, risk, cancelled],
      [resolved(late, 180)],
    );

    const result = await computeSla(
      { days: 30 },
      { db: store, data: createReferenceData(), clock },
    );

    expect(result.summary).toMatchObject({
      total: 3,
      closed: 1,
      open: 2,
      cancelled: 1,
      lateClosed: 1,
      openOverdue: 1,
      atRisk: 1,
      slaOnTimePercent: 0,
      avgLateMinutes: 120,
    });
    expect(result.worst.map((row) => row.id)).toEqual(['overdue', 'late']);
    expect(result.worst[0]).toMatchObject({ state: 'overdue-open', lateMinutes: 4260 });
    expect(result.worst[1]).toMatchObject({ state: 'late-closed', lateMinutes: 120 });
    expect(result.byPriority.map((row) => row.priority)).toEqual(['critical', 'high', 'low']);
    expect(result.byDepartment.map((row) => row.departmentId)).toEqual(['dep-network', 'dep-it']);
  });

  it('фиксирует нарушение срока реакции', async () => {
    const ticket = makeTicket('t-1');
    const store = await storeWith([ticket], [assigned(ticket, 120), resolved(ticket, 150)]);

    const result = await computeSla(
      { days: 30 },
      { db: store, data: createReferenceData(), clock },
    );

    expect(result.summary).toMatchObject({
      reactionKnown: 1,
      reactionOnTime: 0,
      reactionBreaches: 1,
      reactionOnTimePercent: 0,
      avgReactionMinutes: 120,
    });
  });

  it('фильтрует по приоритету и исполнителю', async () => {
    const store = await storeWith([
      makeTicket('t-1', { priority: 'high' }),
      makeTicket('t-2', { priority: 'low', assigneeId: 'u-engineer-3' }),
    ]);

    const byPriority = await computeSla(
      { days: 30, priority: 'high' },
      { db: store, data: createReferenceData(), clock },
    );
    const byAssignee = await computeSla(
      { days: 30, assigneeId: 'u-engineer-3' },
      { db: store, data: createReferenceData(), clock },
    );

    expect(byPriority.summary.total).toBe(1);
    expect(byPriority.filters).toEqual({ priority: 'high' });
    expect(byAssignee.summary.total).toBe(1);
    expect(byAssignee.byPriority[0]?.priority).toBe('low');
  });
});
