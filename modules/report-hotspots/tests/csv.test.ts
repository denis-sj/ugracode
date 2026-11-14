import { describe, expect, it } from 'vitest';
import { KernelEventBus, MemoryStore, TicketService, collectRoutes, createReferenceData } from '@ugra/core';
import type { ModuleDeps } from '@ugra/core';
import { makePorts, makeUser } from '@ugra/testkit';
import type { HotspotsResult } from '../contracts';
import reportHotspots from '../server';
import { buildCsv, csvCell } from '../server/csv';

const clock = { now: () => new Date('2026-11-14T12:00:00.000Z') };

const emptyReport: HotspotsResult = {
  period: { from: '2026-10-15T00:00:00.000Z', to: '2026-11-14T12:00:00.000Z', days: 30 },
  previousPeriod: { from: '2026-09-15T00:00:00.000Z', to: '2026-10-15T00:00:00.000Z', days: 30 },
  filters: {},
  total: 0,
  previousTotal: 0,
  trendPercent: null,
  repeatedTickets: 0,
  rows: [],
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

describe('CSV отчёта О2', () => {
  it('начинается с BOM, использует «;» и заголовки колонок', () => {
    const csv = buildCsv(emptyReport);
    expect(csv.startsWith('\uFEFFКорпус;Кабинет;Точка;Тип')).toBe(true);
    expect(csv).toContain('Число заявок;Доля, %');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('экранирует «;», кавычки и переводы строк', () => {
    expect(csvCell('каб; 312')).toBe('"каб; 312"');
    expect(csvCell('он сказал "да"')).toBe('"он сказал ""да"""');
    expect(csvCell('две\nстроки')).toBe('"две\nстроки"');
    expect(csvCell(null)).toBe('');
  });
});

describe('маршруты О2', () => {
  it('объявляет маршруты с правом reports', () => {
    const mounted = collectRoutes([reportHotspots], deps(new MemoryStore()));
    const routes = mounted[0]?.routes ?? [];
    const paths = routes.map((route) => `${route.method} ${route.path}`);
    expect(paths).toContain('GET /');
    expect(paths).toContain('POST /run');
    expect(paths).toContain('GET /export');
    expect(routes.every((route) => route.access === 'reports')).toBe(true);
  });

  it('на не-CSV формат отвечает 400', async () => {
    const moduleDeps = deps(new MemoryStore());
    const route = collectRoutes([reportHotspots], moduleDeps)[0]?.routes.find(
      (item) => item.method === 'GET' && item.path === '/export',
    );
    expect(route).toBeDefined();
    await expect(
      route?.handler({
        body: {},
        params: {},
        query: { format: 'pdf' },
        user: makeUser({ role: 'manager' }),
        deps: moduleDeps,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('на format=csv отдаёт CSV с BOM', async () => {
    const moduleDeps = deps(new MemoryStore());
    const route = collectRoutes([reportHotspots], moduleDeps)[0]?.routes.find(
      (item) => item.method === 'GET' && item.path === '/export',
    );
    const response = await route?.handler({
      body: {},
      params: {},
      query: { format: 'csv', days: '7' },
      user: makeUser({ role: 'manager' }),
      deps: moduleDeps,
    });
    expect(typeof response).toBe('string');
    expect(String(response).startsWith('\uFEFF')).toBe(true);
  });
});
