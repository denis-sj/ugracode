import { describe, expect, it } from 'vitest';
import { KernelEventBus, MemoryStore, TicketService, collectRoutes, createReferenceData } from '@ugra/core';
import type { ModuleDeps } from '@ugra/core';
import { makePorts, makeUser } from '@ugra/testkit';
import type { AiEffectResult } from '../contracts';
import reportAiEffect from '../server';
import { buildCsv, csvCell } from '../server/csv';

const clock = { now: () => new Date('2026-11-14T12:00:00.000Z') };

const report: AiEffectResult = {
  period: { from: '2026-10-15T00:00:00.000Z', to: '2026-11-14T12:00:00.000Z', days: 30 },
  totals: {
    ticketsWithAi: 6,
    fieldsSuggested: 18,
    fieldsCorrected: 3,
    ticketsWithoutEdits: 3,
    shareWithoutEditsPercent: 50,
    avgCorrectionsPerTicket: 0.5,
    avgMinutesToConfirm: 12.5,
    confirmedTickets: 4,
    correctionsByField: [
      { fieldKey: 'cabinet', label: 'Кабинет; этаж', corrections: 2, suggestions: 6 },
    ],
  },
  comparison: {
    withAi: { tickets: 6, avgMinutesToConfirm: 12.5 },
    withoutAi: null,
    source: 'none',
    note: 'Замеров ручного режима ещё нет.',
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

describe('CSV отчёта О5', () => {
  it('содержит цифры эффекта и честную строку про ручной режим', () => {
    const csv = buildCsv(report);
    expect(csv.startsWith('\uFEFFПоказатель;Значение')).toBe(true);
    expect(csv).toContain('Заявок с подсказками ИИ;6');
    expect(csv).toContain('Без правок, %;50');
    expect(csv).toContain('Среднее время до подтверждения, мин;12,5');
    expect(csv).toContain('Замеров ручного режима;нет данных');
    expect(csv).toContain('"Поле: Кабинет; этаж";2');
  });

  it('экранирует ячейки', () => {
    expect(csvCell('а;б')).toBe('"а;б"');
    expect(csvCell(null)).toBe('');
  });
});

describe('маршруты О5', () => {
  it('объявляет маршруты с правом reports', () => {
    const routes = collectRoutes([reportAiEffect], deps(new MemoryStore()))[0]?.routes ?? [];
    expect(routes.map((route) => `${route.method} ${route.path}`)).toEqual([
      'GET /',
      'POST /run',
      'GET /export',
    ]);
    expect(routes.every((route) => route.access === 'reports')).toBe(true);
  });

  it('на XLSX отвечает 400, на CSV — текстом с BOM', async () => {
    const moduleDeps = deps(new MemoryStore());
    const route = collectRoutes([reportAiEffect], moduleDeps)[0]?.routes.find(
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
