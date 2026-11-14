import { describe, expect, it } from 'vitest';
import type { Appeal, Ticket } from '@ugra/contracts';
import { createReferenceData, MemoryStore } from '@ugra/core';
import { OverviewResult } from '../contracts';
import { computeOverdue, computeOverview } from '../server/overview';
import { factsOf } from '../server';

const clock = { now: () => new Date('2026-11-14T12:00:00.000Z') };
const NOW = clock.now().getTime();
const DAY = 24 * 60 * 60 * 1000;

function iso(time: number): string {
  return new Date(time).toISOString();
}

function makeTicket(id: string, overrides: Partial<Ticket> = {}): Ticket {
  const created = NOW - 2 * DAY;
  return {
    id,
    number: `З-20261112-${id}`,
    appealId: `appeal-${id}`,
    status: 'closed',
    priority: 'medium',
    category: 'printer',
    departmentId: 'dep-it',
    assigneeId: 'u-engineer-2',
    isEmergency: false,
    incidentId: null,
    reactDueAt: iso(created + 60 * 60_000),
    slaDueAt: iso(created + 4 * 60 * 60_000),
    equipmentId: 'eq-printer-b312',
    locationId: 'cab-b-312',
    confirmedBy: null,
    confirmedAt: null,
    createdAt: iso(created),
    updatedAt: iso(created + 90 * 60_000),
    ...overrides,
  };
}

async function storeWith(tickets: Ticket[], appeals: Appeal[] = []): Promise<MemoryStore> {
  const store = new MemoryStore();
  for (const ticket of tickets) await store.saveTicket(ticket);
  for (const appeal of appeals) await store.saveAppeal(appeal);
  return store;
}

function appealOf(ticket: Ticket, channel: Appeal['channel']): Appeal {
  return {
    id: ticket.appealId,
    channel,
    authorId: 'u-applicant-1',
    originalText: 'Корпус Б, кабинет 312, принтер не печатает',
    attachments: [],
    createdAt: ticket.createdAt,
  };
}

describe('computeOverview', () => {
  it('на пустой базе возвращает нули и непустые выводы', async () => {
    const result = await computeOverview(
      { days: 30 },
      { db: new MemoryStore(), data: createReferenceData(), clock },
    );

    expect(result.totals.total).toBe(0);
    expect(result.totals.open).toBe(0);
    expect(result.totals.slaOnTimePercent).toBeNull();
    expect(result.avgResolutionMinutes).toBeNull();
    expect(result.byPriority).toHaveLength(5);
    expect(result.hotSpots).toEqual([]);
    expect(result.insights.summary.length).toBeGreaterThan(0);
    expect(result.insights.priorities.length).toBeGreaterThan(0);
    expect(factsOf(result).length).toBeGreaterThan(0);
    expect(factsOf(result).every((fact) => String(fact.value).length > 0)).toBe(true);
    expect(() => OverviewResult.parse(result)).not.toThrow();
  });

  it('считает одну закрытую заявку: агрегаты, время решения и SLA', async () => {
    const store = await storeWith([makeTicket('t-1')]);
    const result = await computeOverview({ days: 30 }, { db: store, data: createReferenceData(), clock });

    expect(result.totals.total).toBe(1);
    expect(result.totals.closed).toBe(1);
    expect(result.totals.open).toBe(0);
    expect(result.avgResolutionMinutes).toBe(90);
    expect(result.totals.slaBreaches).toBe(0);
    expect(result.totals.slaOnTimePercent).toBe(100);
    expect(result.byCategory[0]).toMatchObject({ key: 'printer', count: 1 });
    expect(result.byBuilding[0]).toMatchObject({ key: 'Б', count: 1 });
    expect(result.hotSpots[0]).toMatchObject({ building: 'Б', cabinet: '312', count: 1 });
  });

  it('считает аварии, просрочку и топ горячих точек', async () => {
    const overdue = makeTicket('t-2', {
      status: 'in_progress',
      isEmergency: true,
      priority: 'emergency',
      category: 'network',
      locationId: 'cab-b-312',
      createdAt: iso(NOW - 3 * DAY),
      updatedAt: iso(NOW - 3 * DAY),
      slaDueAt: iso(NOW - 2 * DAY),
    });
    const cancelled = makeTicket('t-3', {
      status: 'cancelled',
      category: 'software',
      locationId: 'cab-a-101',
      equipmentId: null,
      createdAt: iso(NOW - 4 * DAY),
      updatedAt: iso(NOW - 4 * DAY),
    });
    const store = await storeWith([makeTicket('t-1'), overdue, cancelled]);
    await store.appendEvent({
      id: 'e-1',
      type: 'ticket.status.changed',
      at: iso(NOW - 2 * DAY),
      actor: { kind: 'user', id: 'u-engineer-2' },
      ticketId: 't-1',
      payload: { from: 'in_progress', to: 'closed', resolutionMinutes: 90 },
    });

    const result = await computeOverview({ days: 30 }, { db: store, data: createReferenceData(), clock });

    expect(result.totals.total).toBe(3);
    expect(result.totals.closed).toBe(1);
    expect(result.totals.cancelled).toBe(1);
    expect(result.totals.open).toBe(1);
    expect(result.totals.emergency).toBe(1);
    expect(result.totals.slaBreaches).toBe(1);
    expect(result.hotSpots[0]).toMatchObject({ cabinet: '312', count: 2 });
    expect(result.insights.hotspots.meaning).toContain('312');
    expect(result.insights.hotspots.action).toBeTypeOf('string');
  });

  it('отбрасывает заявки вне периода и учитывает прошлый период для сравнения', async () => {
    const old = makeTicket('t-old', {
      createdAt: iso(NOW - 90 * DAY),
      updatedAt: iso(NOW - 90 * DAY + 60 * 60_000),
    });
    const store = await storeWith([makeTicket('t-1'), old]);
    const result = await computeOverview({ days: 30 }, { db: store, data: createReferenceData(), clock });

    expect(result.totals.total).toBe(1);
    expect(result.previousPeriod.days).toBe(30);
    expect(result.deltas.total).toBeNull();
  });

  it('фильтрует по каналу обращения', async () => {
    const phone = makeTicket('t-phone');
    const chat = makeTicket('t-chat', { category: 'pc', locationId: 'cab-a-101' });
    const store = await storeWith([phone, chat], [appealOf(phone, 'phone'), appealOf(chat, 'chat')]);

    const result = await computeOverview(
      { days: 30, channel: 'phone' },
      { db: store, data: createReferenceData(), clock },
    );

    expect(result.totals.total).toBe(1);
    expect(result.byCategory[0]?.key).toBe('printer');
    expect(result.filters.channel).toBe('phone');
  });

  it('строит тепловую карту по рабочим часам', async () => {
    const created = new Date('2026-11-09T10:15:00'); // понедельник, 10 утра
    const ticket = makeTicket('t-heat', {
      createdAt: created.toISOString(),
      updatedAt: new Date(created.getTime() + 60 * 60_000).toISOString(),
    });
    const store = await storeWith([ticket]);
    const result = await computeOverview({ days: 30 }, { db: store, data: createReferenceData(), clock });

    expect(result.heatmap.days).toHaveLength(5);
    expect(result.heatmap.hours).toEqual([8, 9, 10, 11, 12, 13, 14, 15, 16, 17]);
    const monday = result.heatmap.days.find((row) => row.day === 'Пн');
    expect(monday?.cells.find((cell) => cell.hour === 10)?.count).toBe(1);
    expect(result.heatmap.max).toBe(1);
  });
});

describe('данные для карточек дашборда D2', () => {
  it('по каждому приоритету есть ряд по дням периода', async () => {
    const store = await storeWith([
      makeTicket('t-1', { priority: 'emergency', isEmergency: true }),
      makeTicket('t-2', { priority: 'high' }),
      makeTicket('t-3', { priority: 'high' }),
    ]);
    const result = await computeOverview({ days: 30 }, { db: store, data: createReferenceData(), clock });

    expect(result.period.days).toBe(30);
    for (const slice of result.byPriority) {
      expect(slice.daily).toHaveLength(30);
      expect(slice.daily.reduce((sum, value) => sum + value, 0)).toBe(slice.count);
    }
    const high = result.byPriority.find((slice) => slice.key === 'high');
    expect(high?.count).toBe(2);
    expect(high?.daily.reduce((sum, value) => sum + value, 0)).toBe(2);
  });

  it('считает эффект ИИ по правкам диспетчера и не выдумывает цель SLA', async () => {
    const store = await storeWith([makeTicket('t-1'), makeTicket('t-2')]);
    await store.appendEvent({
      id: 'e-1',
      type: 'ticket.field.corrected',
      at: iso(NOW - DAY),
      actor: { kind: 'user', id: 'u-dispatcher-1' },
      ticketId: 't-1',
      payload: { fieldKey: 'cabinet', value: '313', previous: '312' },
    });
    const result = await computeOverview({ days: 30 }, { db: store, data: createReferenceData(), clock });

    expect(result.aiEffect).toEqual({ correctedTickets: 1, totalTickets: 2, withoutEditsPercent: 50 });
    expect(result.slaTargetPercent).toBeNull();
  });

  it('берёт цель SLA из настроек, если она задана', async () => {
    const store = await storeWith([]);
    const result = await computeOverview(
      { days: 30 },
      { db: store, data: createReferenceData({ settings: { slaTargetPercent: 90 } }), clock },
    );
    expect(result.slaTargetPercent).toBe(90);
  });
});

describe('computeOverdue', () => {
  it('отдаёт только открытые просроченные заявки, самые долгие — первыми', async () => {
    const store = await storeWith([
      makeTicket('t-old', { status: 'assigned', slaDueAt: iso(NOW - 3 * DAY) }),
      makeTicket('t-new', { status: 'in_progress', slaDueAt: iso(NOW - 60 * 60_000) }),
      makeTicket('t-ok', { status: 'in_progress', slaDueAt: iso(NOW + 5 * DAY) }),
      makeTicket('t-closed', { status: 'closed', slaDueAt: iso(NOW - 5 * DAY) }),
    ]);
    const result = await computeOverdue({ days: 30 }, { db: store, data: createReferenceData(), clock });

    expect(result.total).toBe(2);
    expect(result.items.map((item) => item.ticketId)).toEqual(['t-old', 't-new']);
    expect(result.items[0]?.overdueMinutes).toBe(3 * 24 * 60);
    expect(result.groups[0]).toMatchObject({ assigneeId: 'u-engineer-2', count: 2 });
  });

  it('на пустой базе — пустой список, а не ошибка', async () => {
    const result = await computeOverdue({ days: 30 }, { db: new MemoryStore(), data: createReferenceData(), clock });
    expect(result).toEqual({ total: 0, items: [], groups: [] });
  });
});
