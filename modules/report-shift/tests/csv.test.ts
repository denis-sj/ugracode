import { describe, expect, it } from 'vitest';
import { KernelEventBus, MemoryStore, TicketService, collectRoutes, createReferenceData } from '@ugra/core';
import type { ModuleDeps } from '@ugra/core';
import { makePorts, makeUser } from '@ugra/testkit';
import type { ShiftResult } from '../contracts';
import reportShift from '../server';
import { buildCsv, csvCell } from '../server/csv';

const clock = { now: () => new Date('2026-11-14T18:00:00.000Z') };

const report: ShiftResult = {
  period: {
    date: '2026-11-14',
    from: '2026-11-14T00:00:00.000Z',
    to: '2026-11-15T00:00:00.000Z',
  },
  totals: {
    total: 2,
    created: 1,
    closed: 1,
    emergency: 0,
    slaBreaches: 0,
    slaOnTimePercent: 100,
  },
  byAssignee: [
    {
      assigneeId: 'u-engineer-2',
      name: 'Кузнецов; Артём',
      total: 2,
      open: 1,
      closed: 1,
      avgResolutionMinutes: 90,
    },
  ],
  attention: {
    overdue: [],
    overdueCount: 0,
    waitingReview: [
      {
        id: 't-2',
        number: 'З-2',
        status: 'in_review',
        priority: 'high',
        category: 'printer',
        assigneeId: null,
        createdAt: '2026-11-14T10:00:00.000Z',
        slaDueAt: null,
      },
    ],
    waitingReviewCount: 1,
  },
};

function deps(store: MemoryStore): ModuleDeps {
  const bus = new KernelEventBus(store);
  return {
    bus,
    ports: makePorts(),
    data: createReferenceData(),
    db: store,
    tickets: new TicketService({ store, bus, clock }),
    settings: { get: async () => undefined },
    clock,
  };
}

describe('CSV отчёта О1', () => {
  it('содержит сводку, исполнителей и внимание', () => {
    const csv = buildCsv(report);
    expect(csv.startsWith('\uFEFFРаздел;Показатель;Значение')).toBe(true);
    expect(csv).toContain('Смена;Всего заявок;2');
    expect(csv).toContain('Внимание;Ждут проверки;1');
    expect(csv).toContain('Исполнитель;"Кузнецов; Артём";2');
  });

  it('экранирует опасные символы', () => {
    expect(csvCell('а;б')).toBe('"а;б"');
    expect(csvCell('"цитата"')).toBe('"""цитата"""');
    expect(csvCell(0)).toBe('0');
  });
});

describe('маршруты О1', () => {
  it('объявляет маршруты с правом reports', () => {
    const routes = collectRoutes([reportShift], deps(new MemoryStore()))[0]?.routes ?? [];
    expect(routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      'GET /',
      'POST /run',
      'GET /export',
    ]);
    expect(routes.every((route) => route.access === 'reports')).toBe(true);
  });

  it('на PDF отвечает 400, на CSV — текстом с BOM', async () => {
    const moduleDeps = deps(new MemoryStore());
    const route = collectRoutes([reportShift], moduleDeps)[0]?.routes.find(
      (item) => item.method === 'GET' && item.path === '/export',
    );

    await expect(
      route?.handler({
        body: {},
        params: {},
        query: { format: 'pdf' },
        user: makeUser({ role: 'manager' }),
        deps: moduleDeps,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });

    const csv = await route?.handler({
      body: {},
      params: {},
      query: { format: 'csv' },
      user: makeUser({ role: 'manager' }),
      deps: moduleDeps,
    });
    expect(String(csv).startsWith('\uFEFF')).toBe(true);
  });
});
