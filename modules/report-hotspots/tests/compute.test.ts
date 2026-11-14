import { describe, expect, it } from 'vitest';
import type { Ticket } from '@ugra/contracts';
import { createReferenceData, MemoryStore } from '@ugra/core';
import { HotspotsResult } from '../contracts';
import { computeHotspots } from '../server/compute';
import { factsOf } from '../server';

const NOW = new Date(2026, 10, 14, 12, 0, 0);
const clock = { now: () => NOW };
const DAY = 24 * 60 * 60 * 1000;

function daysAgo(days: number, hours = 0): string {
  return new Date(NOW.getTime() - days * DAY + hours * 60 * 60 * 1000).toISOString();
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
    reactDueAt: created,
    slaDueAt: created,
    equipmentId: 'eq-b312',
    locationId: 'cab-b-312',
    confirmedBy: null,
    confirmedAt: null,
    createdAt: created,
    updatedAt: new Date(Date.parse(created) + 90 * 60_000).toISOString(),
    ...overrides,
  };
}

async function storeWith(tickets: Ticket[]): Promise<MemoryStore> {
  const store = new MemoryStore();
  for (const ticket of tickets) await store.saveTicket(ticket);
  return store;
}

describe('computeHotspots', () => {
  it('на пустой базе отдаёт нули и пустые строки', async () => {
    const result = await computeHotspots(
      { days: 30 },
      { db: new MemoryStore(), data: createReferenceData(), clock },
    );

    expect(result.total).toBe(0);
    expect(result.previousTotal).toBe(0);
    expect(result.trendPercent).toBeNull();
    expect(result.rows).toEqual([]);
    expect(() => HotspotsResult.parse(result)).not.toThrow();
    expect(factsOf(result).length).toBeGreaterThan(0);
  });

  it('считает одну заявку: оборудование, доля и время решения', async () => {
    const ticket = makeTicket('t-1');
    const store = await storeWith([ticket]);
    await store.saveTicketFields('t-1', [
      {
        ticketId: 't-1',
        fieldKey: 'equipment',
        value: 'HP LaserJet Pro M404dn',
        confidence: 0.9,
        quote: null,
        origin: 'text',
        needsReview: false,
        trace: [],
        aiValue: 'HP LaserJet Pro M404dn',
      },
    ]);

    const result = await computeHotspots(
      { days: 30 },
      { db: store, data: createReferenceData(), clock },
    );

    expect(result.total).toBe(1);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      kind: 'equipment',
      equipmentId: 'eq-b312',
      building: 'Б',
      cabinet: '312',
      count: 1,
      sharePercent: 100,
      avgResolutionMinutes: 90,
    });
    expect(result.rows[0]?.label).toContain('HP LaserJet Pro M404dn');
  });

  it('группирует повторы и не берёт заявки вне периода', async () => {
    const store = await storeWith([
      makeTicket('t-1'),
      makeTicket('t-2'),
      makeTicket('t-3', { locationId: 'cab-a-101', equipmentId: null }),
      makeTicket('old', { createdAt: daysAgo(90), updatedAt: daysAgo(90) }),
    ]);

    const result = await computeHotspots(
      { days: 30 },
      { db: store, data: createReferenceData(), clock },
    );

    expect(result.total).toBe(3);
    expect(result.rows[0]).toMatchObject({ count: 2, kind: 'equipment' });
    expect(result.rows[1]).toMatchObject({ count: 1, kind: 'cabinet', cabinet: '101' });
    expect(result.repeatedTickets).toBe(2);
  });

  it('сравнивает с прошлым периодом: тренд строки и общий', async () => {
    const store = await storeWith([
      makeTicket('t-1'),
      makeTicket('old-1', { createdAt: daysAgo(40), updatedAt: daysAgo(40) }),
      makeTicket('old-2', { createdAt: daysAgo(41), updatedAt: daysAgo(41) }),
    ]);

    const result = await computeHotspots(
      { days: 30 },
      { db: store, data: createReferenceData(), clock },
    );

    expect(result.previousTotal).toBe(2);
    expect(result.trendPercent).toBe(-50);
    expect(result.rows[0]?.previousCount).toBe(2);
    expect(result.rows[0]?.trendPercent).toBe(-50);
  });

  it('фильтрует по корпусу и категории', async () => {
    const store = await storeWith([
      makeTicket('t-1'),
      makeTicket('t-2', { locationId: 'cab-a-101', category: 'pc', equipmentId: null }),
      makeTicket('t-3', { locationId: 'cab-b-201', equipmentId: null }),
    ]);

    const byBuilding = await computeHotspots(
      { days: 30, building: 'Б' },
      { db: store, data: createReferenceData(), clock },
    );
    const byCategory = await computeHotspots(
      { days: 30, category: 'pc' },
      { db: store, data: createReferenceData(), clock },
    );

    expect(byBuilding.total).toBe(2);
    expect(byBuilding.rows.every((row) => row.building === 'Б')).toBe(true);
    expect(byCategory.total).toBe(1);
    expect(byCategory.rows[0]?.category).toBe('pc');
  });

  it('оставляет в таблице не больше десяти точек', async () => {
    const tickets = Array.from({ length: 12 }, (_, index) =>
      makeTicket(`t-${index}`, {
        locationId: `cab-b-${300 + index}`,
        equipmentId: null,
      }),
    );
    const store = await storeWith(tickets);

    const result = await computeHotspots(
      { days: 30 },
      { db: store, data: createReferenceData(), clock },
    );

    expect(result.rows).toHaveLength(10);
    expect(result.total).toBe(12);
  });
});
