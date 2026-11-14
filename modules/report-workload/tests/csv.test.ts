import { describe, expect, it } from 'vitest';
import { KernelEventBus, MemoryStore, TicketService, collectRoutes, createReferenceData } from '@ugra/core';
import type { ModuleDeps } from '@ugra/core';
import { makePorts, makeUser } from '@ugra/testkit';
import type { WorkloadResult } from '../contracts';
import reportWorkload from '../server';
import { buildCsv, csvCell } from '../server/csv';

const clock = { now: () => new Date('2026-11-14T12:00:00.000Z') };

const emptyReport: WorkloadResult = {
  period: { from: '2026-10-15T12:00:00.000Z', to: '2026-11-14T12:00:00.000Z', days: 30 },
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

describe('CSV отчёта О4', () => {
  it('начинается с BOM, отдаёт таблицу исполнителей и подразделений', () => {
    const csv = buildCsv(emptyReport);
    expect(csv.startsWith('\uFEFFИсполнитель;Подразделение;Открыто;Закрыто')).toBe(true);
    expect(csv).toContain('Подразделение;Инженеров;Открыто;Закрыто;Доля открытых, %');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('экранирует «;», кавычки и переводы строк', () => {
    expect(csvCell('каб; 312')).toBe('"каб; 312"');
    expect(csvCell('он сказал "да"')).toBe('"он сказал ""да"""');
    expect(csvCell('две\nстроки')).toBe('"две\nстроки"');
    expect(csvCell(undefined)).toBe('');
  });
});

describe('маршруты О4', () => {
  it('объявляет маршруты с правом reports', () => {
    const mounted = collectRoutes([reportWorkload], deps(new MemoryStore()));
    const routes = mounted[0]?.routes ?? [];
    const paths = routes.map((route) => `${route.method} ${route.path}`);
    expect(paths).toContain('GET /');
    expect(paths).toContain('POST /run');
    expect(paths).toContain('GET /export');
    expect(routes.every((route) => route.access === 'reports')).toBe(true);
  });

  it('на не-CSV формат отвечает 400', async () => {
    const moduleDeps = deps(new MemoryStore());
    const route = collectRoutes([reportWorkload], moduleDeps)[0]?.routes.find(
      (item) => item.method === 'GET' && item.path === '/export',
    );
    await expect(
      route?.handler({
        body: {},
        params: {},
        query: { format: 'xlsx' },
        user: makeUser({ role: 'manager' }),
        deps: moduleDeps,
      }),
    ).rejects.toMatchObject({ statusCode: 400 });
  });

  it('на format=csv отдаёт CSV с BOM', async () => {
    const moduleDeps = deps(new MemoryStore());
    const route = collectRoutes([reportWorkload], moduleDeps)[0]?.routes.find(
      (item) => item.method === 'GET' && item.path === '/export',
    );
    const response = await route?.handler({
      body: {},
      params: {},
      query: { format: 'csv', days: '7', departmentId: 'dep-it' },
      user: makeUser({ role: 'manager' }),
      deps: moduleDeps,
    });
    expect(typeof response).toBe('string');
    expect(String(response).startsWith('\uFEFF')).toBe(true);
  });
});
