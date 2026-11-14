import { describe, expect, it } from 'vitest';
import type { DomainEvent, Ticket } from '@ugra/contracts';
import { createReferenceData, MemoryStore } from '@ugra/core';
import { EmergencyResult } from '../contracts';
import { computeEmergency } from '../server/compute';
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
    priority: 'emergency',
    category: 'network',
    departmentId: 'dep-network',
    assigneeId: 'u-engineer-3',
    isEmergency: true,
    incidentId: null,
    reactDueAt: new Date(Date.parse(created) + 15 * MIN).toISOString(),
    slaDueAt: new Date(Date.parse(created) + 60 * MIN).toISOString(),
    equipmentId: 'eq-switch-1',
    locationId: 'cab-b-210',
    confirmedBy: null,
    confirmedAt: null,
    createdAt: created,
    updatedAt: new Date(Date.parse(created) + 35 * MIN).toISOString(),
    ...overrides,
  };
}

function event(id: string, type: string, at: string, payload: Record<string, unknown>, ticketId?: string): DomainEvent {
  return { id, type, at, actor: { kind: 'user', id: 'u-test' }, ticketId, payload };
}

async function storeWith(tickets: Ticket[], events: DomainEvent[] = []): Promise<MemoryStore> {
  const store = new MemoryStore();
  for (const ticket of tickets) await store.saveTicket(ticket);
  for (const item of events) await store.appendEvent(item);
  return store;
}

describe('computeEmergency', () => {
  it('на пустой базе отдаёт нули и «нет данных» там, где цифры неоткуда взять', async () => {
    const result = await computeEmergency(
      { days: 30 },
      { db: new MemoryStore(), data: createReferenceData(), clock },
    );

    expect(result.summary).toMatchObject({
      total: 0,
      emergency: 0,
      sharePercent: null,
      closed: 0,
      open: 0,
      reactionMeasured: 0,
      avgReactionMinutes: null,
      repeatedHotspots: 0,
      detectedSignals: 0,
      suspectedSignals: 0,
      falseAlarms: null,
    });
    expect(result.hotspots).toEqual([]);
    expect(result.recent).toEqual([]);
    expect(() => EmergencyResult.parse(result)).not.toThrow();
    expect(factsOf(result).length).toBeGreaterThan(0);
  });

  it('считает одну аварию: доля, реакция и последние аварии', async () => {
    const ticket = makeTicket('t-1');
    const at = new Date(Date.parse(ticket.createdAt) + 10 * MIN).toISOString();
    const store = await storeWith(
      [ticket, makeTicket('usual', { isEmergency: false, priority: 'medium' })],
      [event('ev-1', 'ticket.assigned', at, { assigneeId: 'u-engineer-3' }, 't-1')],
    );

    const result = await computeEmergency(
      { days: 30 },
      { db: store, data: createReferenceData(), clock },
    );

    expect(result.summary).toMatchObject({
      total: 2,
      emergency: 1,
      sharePercent: 50,
      closed: 1,
      open: 0,
      reactionMeasured: 1,
      avgReactionMinutes: 10,
    });
    expect(result.recent).toHaveLength(1);
    expect(result.recent[0]).toMatchObject({ id: 't-1', equipmentId: 'eq-switch-1' });
  });

  it('не берёт заявки вне периода', async () => {
    const store = await storeWith([
      makeTicket('fresh'),
      makeTicket('old', { createdAt: daysAgo(90), updatedAt: daysAgo(90) }),
    ]);

    const result = await computeEmergency(
      { days: 30 },
      { db: store, data: createReferenceData(), clock },
    );

    expect(result.summary.total).toBe(1);
  });

  it('находит повторные аварии по технике и месту', async () => {
    const store = await storeWith([
      makeTicket('eq-1'),
      makeTicket('eq-2'),
      makeTicket('loc-1', { equipmentId: null, locationId: 'cab-a-101' }),
      makeTicket('loc-2', { equipmentId: null, locationId: 'cab-a-101' }),
      makeTicket('single', { equipmentId: 'eq-printer', locationId: 'cab-v-201' }),
    ]);

    const result = await computeEmergency(
      { days: 30 },
      { db: store, data: createReferenceData(), clock },
    );

    expect(result.summary.repeatedHotspots).toBe(2);
    expect(result.hotspots.map((row) => row.key)).toEqual([
      'eq:eq-switch-1',
      'loc:cab-a-101',
    ]);
    expect(result.hotspots[0]).toMatchObject({
      kind: 'equipment',
      count: 2,
      sharePercent: 40,
      locationId: 'cab-b-210',
    });
    expect(result.hotspots[1]).toMatchObject({ kind: 'location', count: 2 });
    expect(result.hotspots[1]?.label).toContain('каб. 101');
  });

  it('считает ложные тревоги по журналу или честно отдаёт null', async () => {
    const from = daysAgo(1);
    const store = await storeWith(
      [makeTicket('t-1')],
      [
        event('sig-1', 'emergency.detected', from, { level: 'suspected' }),
        event('sig-2', 'emergency.detected', from, { level: 'suspected' }),
        event('sig-3', 'emergency.detected', from, { level: 'confirmed' }),
      ],
    );
    const withSignals = await computeEmergency(
      { days: 30 },
      { db: store, data: createReferenceData(), clock },
    );
    const withoutSignals = await computeEmergency(
      { days: 30 },
      { db: await storeWith([makeTicket('t-1')]), data: createReferenceData(), clock },
    );

    expect(withSignals.summary).toMatchObject({
      detectedSignals: 3,
      suspectedSignals: 2,
      falseAlarms: 2,
    });
    expect(withoutSignals.summary.falseAlarms).toBeNull();
  });

  it('клик по цифре превращается в фильтр заявок', () => {
    const result = {
      period: { from: '', to: '', days: 30 },
      filters: {},
      summary: {
        total: 1,
        emergency: 1,
        sharePercent: 100,
        closed: 1,
        open: 0,
        reactionMeasured: 0,
        avgReactionMinutes: null,
        repeatedHotspots: 0,
        detectedSignals: 0,
        suspectedSignals: 0,
        falseAlarms: null,
      },
      hotspots: [],
      recent: [],
    };
    expect(drilldownOf(result, 'emergency')).toEqual({ days: 30, isEmergency: true });
    expect(drilldownOf(result, 'repeated')).toEqual({
      days: 30,
      isEmergency: true,
      repeated: true,
    });
    expect(drilldownOf(result, 'false-alarms')).toEqual({ days: 30, level: 'suspected' });
    expect(drilldownOf(result, 'equipment:eq-1')).toEqual({ days: 30, equipmentId: 'eq-1' });
    expect(drilldownOf(result, 'location:cab-b-210')).toEqual({
      days: 30,
      locationId: 'cab-b-210',
    });
    expect(drilldownOf(result, 'nope')).toEqual({ days: 30 });
  });
});
