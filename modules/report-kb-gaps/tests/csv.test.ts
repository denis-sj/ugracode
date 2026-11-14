import { describe, expect, it } from 'vitest';
import { KernelEventBus, MemoryStore, TicketService, collectRoutes, createReferenceData } from '@ugra/core';
import type { ModuleDeps } from '@ugra/core';
import { makePorts, makeUser } from '@ugra/testkit';
import type { KbGapsResult } from '../contracts';
import reportKbGaps from '../server';
import { buildCsv, csvCell } from '../server/csv';

const clock = { now: () => new Date('2026-11-14T12:00:00.000Z') };

const emptyReport: KbGapsResult = {
  period: { from: '2026-10-15T12:00:00.000Z', to: '2026-11-14T12:00:00.000Z', days: 30 },
  filters: {},
  summary: {
    total: 0,
    analyzed: 0,
    withArticle: 0,
    withoutArticle: 0,
    shareWithoutArticlePercent: null,
    themes: 0,
    fromJournal: 0,
    fromKnowledgeBase: 0,
  },
  themes: [],
  byCategory: [],
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

describe('CSV отчёта О6', () => {
  it('начинается с BOM и содержит обе таблицы', () => {
    const csv = buildCsv(emptyReport);
    expect(csv.startsWith('\uFEFFТема;Категория;Заявок;Доля без статьи, %')).toBe(true);
    expect(csv).toContain('Категория;Всего заявок;Без статьи;Доля, %;Частая тема');
    expect(csv.endsWith('\r\n')).toBe(true);
  });

  it('экранирует «;», кавычки и переводы строк', () => {
    expect(csvCell('VPN; сеть')).toBe('"VPN; сеть"');
    expect(csvCell('он сказал "да"')).toBe('"он сказал ""да"""');
    expect(csvCell('две\nстроки')).toBe('"две\nстроки"');
    expect(csvCell(null)).toBe('');
  });
});

describe('маршруты О6', () => {
  it('объявляет маршруты с правом reports', () => {
    const mounted = collectRoutes([reportKbGaps], deps(new MemoryStore()));
    const routes = mounted[0]?.routes ?? [];
    const paths = routes.map((route) => `${route.method} ${route.path}`);
    expect(paths).toContain('GET /');
    expect(paths).toContain('POST /run');
    expect(paths).toContain('GET /export');
    expect(routes.every((route) => route.access === 'reports')).toBe(true);
  });

  it('на не-CSV формат отвечает 400', async () => {
    const moduleDeps = deps(new MemoryStore());
    const route = collectRoutes([reportKbGaps], moduleDeps)[0]?.routes.find(
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
    const route = collectRoutes([reportKbGaps], moduleDeps)[0]?.routes.find(
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
