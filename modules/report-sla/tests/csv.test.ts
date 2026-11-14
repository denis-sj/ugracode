import { describe, expect, it } from 'vitest';
import { KernelEventBus, MemoryStore, TicketService, collectRoutes, createReferenceData } from '@ugra/core';
import type { ModuleDeps } from '@ugra/core';
import { makePorts, makeUser } from '@ugra/testkit';
import type { SlaResult } from '../contracts';
import reportSla from '../server';
import { buildCsv, csvCell } from '../server/csv';

const clock = { now: () => new Date('2026-11-14T12:00:00.000Z') };

const emptyReport: SlaResult = {
  period: { from: '2026-10-15T12:00:00.000Z', to: '2026-11-14T12:00:00.000Z', days: 30 },
  filters: {},
  summary: {
    total: 0,
    closed: 0,
    open: 0,
    cancelled: 0,
    dueKnown: 0,
    onTimeClosed: 0,
    lateClosed: 0,
    openOverdue: 0,
    atRisk: 0,
    slaOnTimePercent: null,
    reactionKnown: 0,
    reactionMeasured: 0,
    reactionOnTime: 0,
    reactionBreaches: 0,
    reactionOnTimePercent: null,
    avgReactionMinutes: null,
    avgResolutionMinutes: null,
    avgLateMinutes: null,
  },
  byPriority: [],
  byDepartment: [],
  worst: [],
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

describe('CSV отчёта О3', () => {
  it('начинается с BOM, использует «;» и заголовки колонок', () => {
    const csv = buildCsv(emptyReport);
    expect(csv.startsWith('\uFEFFРаздел;Показатель;Значение')).toBe(true);
    expect(csv).toContain('Сводка;Заявок за период;0');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('экранирует «;», кавычки и переводы строк', () => {
    expect(csvCell('каб; 312')).toBe('"каб; 312"');
    expect(csvCell('он сказал "да"')).toBe('"он сказал ""да"""');
    expect(csvCell('две\nстроки')).toBe('"две\nстроки"');
    expect(csvCell(null)).toBe('');
  });
});

describe('маршруты О3', () => {
  it('объявляет маршруты с правом reports', () => {
    const mounted = collectRoutes([reportSla], deps(new MemoryStore()));
    const routes = mounted[0]?.routes ?? [];
    const paths = routes.map((route) => `${route.method} ${route.path}`);
    expect(paths).toContain('GET /');
    expect(paths).toContain('POST /run');
    expect(paths).toContain('GET /export');
    expect(routes.every((route) => route.access === 'reports')).toBe(true);
  });

  it('на не-CSV формат отвечает 400', async () => {
    const moduleDeps = deps(new MemoryStore());
    const route = collectRoutes([reportSla], moduleDeps)[0]?.routes.find(
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
    const route = collectRoutes([reportSla], moduleDeps)[0]?.routes.find(
      (item) => item.method === 'GET' && item.path === '/export',
    );
    const response = await route?.handler({
      body: {},
      params: {},
      query: { format: 'csv', days: '7', priority: 'high' },
      user: makeUser({ role: 'manager' }),
      deps: moduleDeps,
    });
    expect(typeof response).toBe('string');
    expect(String(response).startsWith('\uFEFF')).toBe(true);
  });
});
