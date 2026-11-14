import { describe, expect, it } from 'vitest';
import { KernelEventBus, MemoryStore, TicketService, collectRoutes, createReferenceData } from '@ugra/core';
import type { ModuleDeps } from '@ugra/core';
import { makePorts, makeUser } from '@ugra/testkit';
import type { EmergencyResult } from '../contracts';
import reportEmergency from '../server';
import { buildCsv, csvCell } from '../server/csv';

const clock = { now: () => new Date('2026-11-14T12:00:00.000Z') };

const emptyReport: EmergencyResult = {
  period: { from: '2026-10-15T12:00:00.000Z', to: '2026-11-14T12:00:00.000Z', days: 30 },
  filters: {},
  summary: {
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
  },
  hotspots: [],
  recent: [],
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

describe('CSV отчёта О7', () => {
  it('начинается с BOM, использует «;» и пишет «нет данных» пустой ячейкой', () => {
    const csv = buildCsv(emptyReport);
    expect(csv.startsWith('\uFEFFРаздел;Показатель;Значение')).toBe(true);
    expect(csv).toContain('Сводка;Аварий;0');
    expect(csv).toContain('Сводка;Ложных тревог;');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('экранирует «;», кавычки и переводы строк', () => {
    expect(csvCell('каб; 210')).toBe('"каб; 210"');
    expect(csvCell('он сказал "да"')).toBe('"он сказал ""да"""');
    expect(csvCell('две\nстроки')).toBe('"две\nстроки"');
    expect(csvCell(null)).toBe('');
  });
});

describe('маршруты О7', () => {
  it('объявляет маршруты с правом reports', () => {
    const mounted = collectRoutes([reportEmergency], deps(new MemoryStore()));
    const routes = mounted[0]?.routes ?? [];
    const paths = routes.map((route) => `${route.method} ${route.path}`);
    expect(paths).toContain('GET /');
    expect(paths).toContain('POST /run');
    expect(paths).toContain('GET /export');
    expect(routes.every((route) => route.access === 'reports')).toBe(true);
  });

  it('на не-CSV формат отвечает 400', async () => {
    const moduleDeps = deps(new MemoryStore());
    const route = collectRoutes([reportEmergency], moduleDeps)[0]?.routes.find(
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
  });

  it('на format=csv отдаёт CSV с BOM', async () => {
    const moduleDeps = deps(new MemoryStore());
    const route = collectRoutes([reportEmergency], moduleDeps)[0]?.routes.find(
      (item) => item.method === 'GET' && item.path === '/export',
    );
    const response = await route?.handler({
      body: {},
      params: {},
      query: { format: 'csv', days: '90' },
      user: makeUser({ role: 'manager' }),
      deps: moduleDeps,
    });
    expect(typeof response).toBe('string');
    expect(String(response).startsWith('\uFEFF')).toBe(true);
  });
});
