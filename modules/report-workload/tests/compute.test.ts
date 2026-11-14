import { describe, expect, it } from 'vitest';
import type { DomainEvent, Ticket } from '@ugra/contracts';
import { createReferenceData, MemoryStore } from '@ugra/core';
import { WorkloadResult } from '../contracts';
import { computeWorkload } from '../server/compute';
import { drilldownOf, factsOf } from '../server';

const NOW = new Date(2026, 10, 14, 12, 0, 0);
const clock = { now: () => NOW };
const DAY = 24 * 60 * 60 * 1000;
const MIN = 60 * 1000;

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY).toISOString();
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
    reactDueAt: null,
    slaDueAt: null,
    equipmentId: null,
    locationId: null,
    confirmedBy: null,
    confirmedAt: null,
    createdAt: created,
    updatedAt: new Date(Date.parse(created) + 90 * MIN).toISOString(),
    ...overrides,
  };
}

function event(ticketId: string, at: string, minutes: number): DomainEvent {
  return {
    id: `ev-${ticketId}`,
    type: 'ticket.status.changed',
    at,
    actor: { kind: 'user', id: 'u-test' },
    ticketId,
    payload: { from: 'in_progress', to: 'closed', resolvedAt: at, resolutionMinutes: minutes },
  };
}

async function storeWith(tickets: Ticket[], events: DomainEvent[] = []): Promise<MemoryStore> {
  const store = new MemoryStore();
  for (const ticket of tickets) await store.saveTicket(ticket);
  for (const item of events) await store.appendEvent(item);
  return store;
}

describe('computeWorkload', () => {
  it('на пустой базе отдаёт нули и пустые строки', async () => {
    const result = await computeWorkload(
      { days: 30 },
      { db: new MemoryStore(), data: createReferenceData(), clock },
    );

    expect(result.summary).toMatchObject({
      totalOpen: 0,
      totalClosed: 0,
      engineers: 0,
      overloaded: 0,
      avgOpenPerEngineer: 0,
      avgResolutionMinutes: null,
      overloadThreshold: 5,
    });
    expect(result.byEngineer).toEqual([]);
    expect(result.byDepartment).toEqual([]);
    expect(() => WorkloadResult.parse(result)).not.toThrow();
    expect(factsOf(result).length).toBeGreaterThan(0);
  });

  it('считает одну заявку: открытые, закрытые и среднее время', async () => {
    const store = await storeWith([
      makeTicket('open-1', { status: 'assigned' }),
      makeTicket('closed-1'),
    ]);

    const result = await computeWorkload(
      { days: 30 },
      { db: store, data: createReferenceData(), clock },
    );

    expect(result.summary).toMatchObject({
      totalOpen: 1,
      totalClosed: 1,
      engineers: 1,
      avgResolutionMinutes: 90,
    });
    expect(result.byEngineer[0]).toMatchObject({
      assigneeId: 'u-engineer-2',
      open: 1,
      closed: 1,
      total: 2,
      avgResolutionMinutes: 90,
      overload: false,
    });
    expect(result.byDepartment[0]).toMatchObject({
      departmentId: 'dep-it',
      engineers: 1,
      open: 1,
      closed: 1,
      openSharePercent: 100,
    });
  });

  it('берёт закрытые только за период и сам считает время по событию', async () => {
    const fresh = makeTicket('fresh');
    const at = new Date(Date.parse(fresh.createdAt) + 45 * MIN).toISOString();
    const store = await storeWith(
      [
        fresh,
        makeTicket('old', { updatedAt: daysAgo(60) }),
        makeTicket('open-old', { status: 'in_progress', createdAt: daysAgo(80) }),
      ],
      [event('fresh', at, 45)],
    );

    const result = await computeWorkload(
      { days: 30 },
      { db: store, data: createReferenceData(), clock },
    );

    expect(result.summary.totalClosed).toBe(1);
    expect(result.summary.avgResolutionMinutes).toBe(45);
    expect(result.summary.totalOpen).toBe(1);
  });

  it('помечает перегруз и читает порог из настроек', async () => {
    const tickets = Array.from({ length: 6 }, (_, index) =>
      makeTicket(`open-${index}`, { status: 'assigned' }),
    );
    const store = await storeWith(tickets);

    const defaults = await computeWorkload(
      { days: 30 },
      { db: store, data: createReferenceData(), clock },
    );
    const tuned = await computeWorkload(
      { days: 30 },
      { db: store, data: createReferenceData({ settings: { 'workload.overloadOpen': 10 } }), clock },
    );

    expect(defaults.summary).toMatchObject({ overloaded: 1, overloadThreshold: 5 });
    expect(defaults.byEngineer[0]?.overload).toBe(true);
    expect(tuned.summary).toMatchObject({ overloaded: 0, overloadThreshold: 10 });
  });

  it('строит баланс подразделений и фильтрует по подразделению', async () => {
    const store = await storeWith([
      makeTicket('it-1', { status: 'assigned', assigneeId: 'u-engineer-2' }),
      makeTicket('net-1', {
        status: 'assigned',
        departmentId: 'dep-network',
        assigneeId: 'u-engineer-3',
      }),
      makeTicket('net-2', {
        status: 'in_progress',
        departmentId: 'dep-network',
        assigneeId: 'u-engineer-3',
      }),
    ]);

    const all = await computeWorkload(
      { days: 30 },
      { db: store, data: createReferenceData(), clock },
    );
    const network = await computeWorkload(
      { days: 30, departmentId: 'dep-network' },
      { db: store, data: createReferenceData(), clock },
    );

    expect(all.summary.totalOpen).toBe(3);
    expect(all.byDepartment[0]).toMatchObject({ departmentId: 'dep-network', open: 2 });
    expect(all.byDepartment[0]?.openSharePercent).toBe(66.7);
    expect(network.summary.totalOpen).toBe(2);
    expect(network.filters).toEqual({ departmentId: 'dep-network' });
    expect(network.byEngineer).toHaveLength(1);
  });

  it('не считает отменённые и показывает неназначенные заявки отдельной строкой', async () => {
    const store = await storeWith([
      makeTicket('cancelled', { status: 'cancelled' }),
      makeTicket('no-assignee', { status: 'new', assigneeId: null }),
    ]);

    const result = await computeWorkload(
      { days: 30 },
      { db: store, data: createReferenceData(), clock },
    );

    expect(result.summary.totalOpen).toBe(1);
    expect(result.summary.engineers).toBe(0);
    expect(result.byEngineer[0]).toMatchObject({ assigneeId: null, name: 'Не назначено', open: 1 });
  });

  it('клик по цифре превращается в фильтр заявок', () => {
    const result = {
      period: { from: '', to: '', days: 14 },
      filters: {},
      summary: {
        totalOpen: 0,
        totalClosed: 0,
        engineers: 0,
        overloaded: 0,
        avgOpenPerEngineer: 0,
        avgResolutionMinutes: null,
        overloadThreshold: 5,
      },
      byEngineer: [],
      byDepartment: [],
    };
    expect(drilldownOf(result, 'overload')).toEqual({ days: 14, overloaded: true });
    expect(drilldownOf(result, 'assignee:u-1')).toEqual({ days: 14, assigneeId: 'u-1' });
    expect(drilldownOf(result, 'department:dep-it')).toEqual({ days: 14, departmentId: 'dep-it' });
    expect(drilldownOf(result, 'unknown')).toEqual({ days: 14 });
  });
});
