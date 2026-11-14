import { describe, expect, it } from 'vitest';
import type { DomainEvent, Ticket, TicketField } from '@ugra/contracts';
import { createReferenceData, KernelEventBus, MemoryStore, TicketService } from '@ugra/core';
import type { ModuleDeps } from '@ugra/core';
import { makePorts } from '@ugra/testkit';
import { KbGapsResult } from '../contracts';
import { computeKbGaps } from '../server/compute';
import reportKbGaps, { drilldownOf, factsOf, MISS_EVENT } from '../server';

const NOW = new Date(2026, 10, 14, 12, 0, 0);
const clock = { now: () => NOW };
const DAY = 24 * 60 * 60 * 1000;

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
    priority: 'medium',
    category: 'network',
    departmentId: 'dep-network',
    assigneeId: 'u-engineer-3',
    isEmergency: false,
    incidentId: null,
    reactDueAt: null,
    slaDueAt: null,
    equipmentId: null,
    locationId: null,
    confirmedBy: null,
    confirmedAt: null,
    createdAt: created,
    updatedAt: created,
    ...overrides,
  };
}

function field(ticketId: string, fieldKey: string, value: string): TicketField {
  return {
    ticketId,
    fieldKey,
    value,
    confidence: 0.9,
    quote: null,
    origin: 'text',
    needsReview: false,
    trace: [],
    aiValue: value,
  };
}

function analysisEvent(
  ticketId: string,
  symptom: string,
  knowledge: { kind: 'article' | 'ticket'; id: string; title: string; score: number }[],
): DomainEvent {
  return {
    id: `analysis-${ticketId}`,
    type: 'analysis.completed',
    at: daysAgo(2),
    actor: { kind: 'ai' },
    ticketId,
    payload: {
      runId: `run-${ticketId}`,
      status: 'ok',
      draft: {
        fields: { symptoms: { value: symptom }, category: { value: 'network' } },
        knowledge,
      },
    },
  };
}

function missEvent(ticketId: string, symptom: string): DomainEvent {
  return {
    id: `miss-${ticketId}`,
    type: MISS_EVENT,
    at: daysAgo(2),
    actor: { kind: 'system' },
    ticketId,
    payload: { symptom, category: 'network' },
  };
}

async function storeWith(
  tickets: Ticket[],
  options: { events?: DomainEvent[]; fields?: TicketField[] } = {},
): Promise<MemoryStore> {
  const store = new MemoryStore();
  for (const ticket of tickets) {
    await store.saveTicket(ticket);
    const own = (options.fields ?? []).filter((item) => item.ticketId === ticket.id);
    if (own.length > 0) await store.saveTicketFields(ticket.id, own);
  }
  for (const event of options.events ?? []) await store.appendEvent(event);
  return store;
}

describe('computeKbGaps', () => {
  it('на пустой базе отдаёт нули и пустые темы', async () => {
    const result = await computeKbGaps(
      { days: 30 },
      { db: new MemoryStore(), data: createReferenceData(), clock },
    );

    expect(result.summary).toMatchObject({
      total: 0,
      analyzed: 0,
      withArticle: 0,
      withoutArticle: 0,
      shareWithoutArticlePercent: null,
      themes: 0,
      fromJournal: 0,
      fromKnowledgeBase: 0,
    });
    expect(result.themes).toEqual([]);
    expect(result.byCategory).toEqual([]);
    expect(() => KbGapsResult.parse(result)).not.toThrow();
    expect(factsOf(result).length).toBeGreaterThan(0);
  });

  it('засчитывает статью из разбора и не считает пробел', async () => {
    const ticket = makeTicket('t-1');
    const store = await storeWith([ticket], {
      events: [
        analysisEvent('t-1', 'VPN не подключается', [
          { kind: 'article', id: 'kb-vpn', title: 'VPN не подключается', score: 1 },
        ]),
      ],
    });

    const result = await computeKbGaps(
      { days: 30 },
      { db: store, data: createReferenceData(), clock },
    );

    expect(result.summary).toMatchObject({
      total: 1,
      analyzed: 1,
      withArticle: 1,
      withoutArticle: 0,
      shareWithoutArticlePercent: 0,
    });
    expect(result.themes).toEqual([]);
  });

  it('копит пробел из разбора: пустой knowledge и частая тема', async () => {
    const store = await storeWith([makeTicket('t-1'), makeTicket('t-2')], {
      events: [
        analysisEvent('t-1', 'VPN не подключается', []),
        analysisEvent('t-2', 'VPN не подключается', []),
      ],
    });

    const result = await computeKbGaps(
      { days: 30 },
      { db: store, data: createReferenceData(), clock },
    );

    expect(result.summary).toMatchObject({
      total: 2,
      analyzed: 2,
      withoutArticle: 2,
      shareWithoutArticlePercent: 100,
      themes: 1,
    });
    expect(result.themes[0]).toMatchObject({
      symptom: 'VPN не подключается',
      category: 'network',
      count: 2,
      sharePercent: 100,
    });
    expect(result.byCategory[0]).toMatchObject({
      category: 'network',
      total: 2,
      withoutArticle: 2,
      sharePercent: 100,
      topSymptom: 'VPN не подключается',
    });
    expect(drilldownOf(result, result.themes[0]?.key ?? '')).toEqual({
      days: 30,
      symptom: 'VPN не подключается',
      category: 'network',
    });
  });

  it('берёт пробел из события подписчика, когда разбора нет', async () => {
    const store = await storeWith([makeTicket('t-1')], {
      events: [missEvent('t-1', 'Принтер печатает пустые страницы')],
    });

    const result = await computeKbGaps(
      { days: 30 },
      { db: store, data: createReferenceData(), clock },
    );

    expect(result.summary).toMatchObject({ withoutArticle: 1, fromJournal: 1, fromKnowledgeBase: 0 });
    expect(result.themes[0]?.symptom).toBe('Принтер печатает пустые страницы');
  });

  it('ищет статью по базе знаний, если разбора нет', async () => {
    const ticket = makeTicket('t-1');
    const store = await storeWith([ticket], {
      fields: [field('t-1', 'symptoms', 'VPN не подключается, ошибка подключения')],
    });
    await store.saveKnowledgeArticle({
      id: 'kb-vpn',
      title: 'VPN не подключается',
      symptoms: ['VPN не подключается', 'ошибка подключения'],
      steps: ['Проверить логин и пароль'],
      solution: 'Переподключить VPN',
      category: 'network',
    });

    const result = await computeKbGaps(
      { days: 30 },
      { db: store, data: createReferenceData(), clock },
    );

    expect(result.summary).toMatchObject({
      withArticle: 1,
      withoutArticle: 0,
      fromKnowledgeBase: 1,
    });
  });

  it('считает заявку без подходящей статьи пробелом и не берёт старые заявки', async () => {
    const store = await storeWith(
      [makeTicket('fresh'), makeTicket('old', { createdAt: daysAgo(90), updatedAt: daysAgo(90) })],
      { fields: [field('fresh', 'symptoms', 'Монитор мигает и гаснет')] },
    );

    const result = await computeKbGaps(
      { days: 30 },
      { db: store, data: createReferenceData(), clock },
    );

    expect(result.summary).toMatchObject({
      total: 1,
      withoutArticle: 1,
      fromKnowledgeBase: 1,
    });
    expect(result.themes[0]?.label).toBe('Монитор мигает и гаснет');
  });

  it('не считает отменённые заявки', async () => {
    const store = await storeWith([makeTicket('c', { status: 'cancelled' })]);
    const result = await computeKbGaps(
      { days: 30 },
      { db: store, data: createReferenceData(), clock },
    );
    expect(result.summary.total).toBe(0);
  });
});

describe('подписчик О6', () => {
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

  it('пишет событие пробела, когда статьи нет', async () => {
    const store = new MemoryStore();
    const subscriber = reportKbGaps.subscribers[0];
    expect(subscriber).toBeDefined();
    await subscriber?.handle(analysisEvent('t-1', 'VPN не подключается', []), deps(store));

    const events = await store.listEvents({ type: MISS_EVENT });
    expect(events).toHaveLength(1);
    expect(events[0]?.ticketId).toBe('t-1');
    expect(events[0]?.payload).toMatchObject({
      symptom: 'VPN не подключается',
      category: 'network',
    });
  });

  it('молчит, когда разбор нашёл статью', async () => {
    const store = new MemoryStore();
    const subscriber = reportKbGaps.subscribers[0];
    await subscriber?.handle(
      analysisEvent('t-1', 'VPN не подключается', [
        { kind: 'article', id: 'kb-vpn', title: 'VPN', score: 1 },
      ]),
      deps(store),
    );

    expect(await store.listEvents({ type: MISS_EVENT })).toHaveLength(0);
  });
});
