import { describe, expect, it } from 'vitest';
import type { AnalysisDraft, Ticket, TicketField, TicketStatus, User } from '@ugra/contracts';
import {
  createReferenceData,
  KernelEventBus,
  MemoryStore,
  TicketService,
  type ModuleDeps,
  type Ports,
  type StepContext,
} from '@ugra/core';
import massIncident from '../server';
import { classifyCandidate, placeOfTicket } from '../server/place';

const NOW = new Date('2026-11-14T10:15:00.000Z');
const NOW_ISO = NOW.toISOString();
const CURRENT_APPEAL_ID = 'appeal-current';

interface Sent {
  toUserId: string;
  title: string;
  body: string;
}

function minutesBefore(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60_000).toISOString();
}

function makePorts(sent: Sent[] = []): Ports {
  return {
    llm: {
      structured: async () => Promise.reject(new Error('модель не нужна')),
      chat: async () => Promise.reject(new Error('модель не нужна')),
    },
    embeddings: { embed: async () => [] },
    speech: { transcribe: async () => ({ text: '' }) },
    vision: { describe: async () => ({ text: '' }) },
    cmdb: { findEquipment: async () => [], locations: async () => [] },
    history: { similar: async () => [] },
    notifications: {
      send: async (message) => {
        sent.push({ toUserId: message.toUserId, title: message.title, body: message.body });
        return { delivered: true };
      },
    },
    tts: { available: false, speak: () => Promise.reject(new Error('tts не нужен')) },
    clock: { now: () => NOW },
  };
}

function makeData(extra: Record<string, unknown> = {}) {
  return createReferenceData({
    settings: { massWindowMinutes: 15, massThreshold: 5 },
    extra,
  });
}

function makeTicket(patch: Partial<Ticket> & { id: string }): Ticket {
  return {
    number: `З-20261114-${patch.id}`,
    appealId: `a-${patch.id}`,
    status: 'in_review',
    priority: 'medium',
    category: null,
    departmentId: null,
    assigneeId: null,
    isEmergency: false,
    incidentId: null,
    reactDueAt: null,
    slaDueAt: null,
    equipmentId: null,
    locationId: null,
    confirmedBy: null,
    confirmedAt: null,
    createdAt: minutesBefore(5),
    updatedAt: minutesBefore(5),
    ...patch,
  };
}

function ticketFields(
  ticketId: string,
  values: Record<string, string | undefined>,
): TicketField[] {
  return Object.entries(values)
    .filter((entry): entry is [string, string] => entry[1] !== undefined)
    .map(([fieldKey, value]) => ({
      ticketId,
      fieldKey,
      value,
      confidence: 0.9,
      quote: null,
      origin: 'text',
      needsReview: false,
      trace: [],
      aiValue: value,
    }));
}

interface SeedOptions {
  id: string;
  category?: string;
  building?: string;
  cabinet?: string;
  object?: string;
  minutesAgo?: number;
  status?: TicketStatus;
}

async function addTicket(store: MemoryStore, options: SeedOptions): Promise<Ticket> {
  const createdAt = minutesBefore(options.minutesAgo ?? 5);
  const ticket = makeTicket({
    id: options.id,
    category: options.category ?? null,
    status: options.status ?? 'in_review',
    createdAt,
    updatedAt: createdAt,
  });
  await store.saveTicket(ticket);
  await store.saveTicketFields(
    options.id,
    ticketFields(options.id, {
      category: options.category,
      building: options.building,
      cabinet: options.cabinet,
      object: options.object,
    }),
  );
  return ticket;
}

function draftWith(values: Record<string, string>): AnalysisDraft {
  const fields: AnalysisDraft['fields'] = {};
  for (const [key, value] of Object.entries(values)) {
    fields[key] = {
      key,
      value,
      confidence: 0.9,
      quote: null,
      origin: 'text',
      needsReview: false,
      trace: [],
    };
  }
  return { sources: [], fields, missing: [], ext: {} };
}

function currentDraft(): AnalysisDraft {
  return draftWith({ category: 'printer', building: 'Б', cabinet: '312', object: 'принтер' });
}

function context(
  store: MemoryStore,
  draft: AnalysisDraft,
  options: { data?: ReturnType<typeof makeData>; sent?: Sent[] } = {},
): StepContext {
  return {
    runId: 'run-mass',
    appeal: {
      id: CURRENT_APPEAL_ID,
      channel: 'chat',
      authorId: 'u-1',
      originalText: 'Принтер 312 не печатает',
      attachments: [],
      createdAt: NOW_ISO,
    },
    db: store,
    bus: new KernelEventBus(store),
    draft,
    ports: makePorts(options.sent),
    data: options.data ?? makeData(),
    progress: () => undefined,
    trace: () => undefined,
    signal: new AbortController().signal,
  };
}

const step = massIncident.steps[0];

async function seedSimilar(store: MemoryStore, count: number, minutesAgo = 5): Promise<Ticket[]> {
  const tickets: Ticket[] = [];
  for (let index = 1; index <= count; index += 1) {
    tickets.push(
      await addTicket(store, {
        id: `t-${index}`,
        category: 'printer',
        building: 'Б',
        cabinet: '312',
        object: 'принтер',
        minutesAgo,
      }),
    );
  }
  return tickets;
}

describe('mass-incident: шаг mass-incident.detect', () => {
  it('на пустой базе ничего не создаёт', async () => {
    const store = new MemoryStore();

    const patch = await step?.run(context(store, currentDraft()));

    expect(patch).toEqual({});
    expect(await store.listIncidents()).toEqual([]);
  });

  it('склеивает пять похожих за 10 минут и публикует событие', async () => {
    const store = new MemoryStore();
    const seeded = await seedSimilar(store, 5);
    const sent: Sent[] = [];
    const data = makeData({
      engineers: { engineers: [{ id: 'e-duty', onShift: true }, { id: 'e-off', onShift: false }] },
    });

    const patch = await step?.run(context(store, currentDraft(), { data, sent }));

    const incident = patch?.incident;
    expect(incident).toBeDefined();
    expect(incident?.size).toBe(5);
    expect(incident?.reason).toContain('категория «printer»');

    const stored = await store.listIncidents();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.number).toMatch(/^И-20261114-\d{4}$/);
    expect(stored[0]?.priority).toBe('emergency');

    for (const ticket of seeded) {
      expect((await store.getTicket(ticket.id))?.incidentId).toBe(incident?.incidentId);
    }

    const events = await store.listEvents({ type: 'mass-incident.opened' });
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toMatchObject({
      number: stored[0]?.number,
      size: 5,
      category: 'printer',
      building: 'Б',
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.toUserId).toBe('e-duty');
    expect(sent[0]?.body).toContain(stored[0]?.number ?? '');
  });

  it('четыре похожих — порог не пройден, инцидента нет', async () => {
    const store = new MemoryStore();
    await seedSimilar(store, 4);

    const patch = await step?.run(context(store, currentDraft()));

    expect(patch).toEqual({});
    expect(await store.listIncidents()).toEqual([]);
  });

  it('старые обращения вне окна не считаются', async () => {
    const store = new MemoryStore();
    await seedSimilar(store, 5, 20);

    const patch = await step?.run(context(store, currentDraft()));

    expect(patch).toEqual({});
    expect(await store.listIncidents()).toEqual([]);
  });

  it('разные системы в одном месте — сигнал, но ниже порога инцидента нет', async () => {
    const store = new MemoryStore();
    const variants: Array<[string, string]> = [
      ['pc', 'компьютер'],
      ['network', 'сеть'],
      ['software', '1С'],
      ['server', 'сервер'],
    ];
    for (const [index, [category, object]] of variants.entries()) {
      await addTicket(store, {
        id: `mix-${index}`,
        category,
        building: 'Б',
        cabinet: '312',
        object,
      });
    }

    const target = placeOfTicket(
      makeTicket({ id: 'target', category: 'printer' }),
      ticketFields('target', { category: 'printer', building: 'Б', cabinet: '312', object: 'принтер' }),
    );
    const candidate = placeOfTicket(
      makeTicket({ id: 'network', category: 'network' }),
      ticketFields('network', { category: 'network', building: 'Б', cabinet: '312', object: 'сеть' }),
    );
    expect(classifyCandidate(target, candidate)).toBe('mixed-place');

    const patch = await step?.run(context(store, currentDraft()));

    expect(patch).toEqual({});
    expect(await store.listIncidents()).toEqual([]);
  });

  it('повторный шаг находит открытый инцидент и второй не создаёт', async () => {
    const store = new MemoryStore();
    await seedSimilar(store, 5);

    const first = await step?.run(context(store, currentDraft()));
    const second = await step?.run(context(store, currentDraft()));

    expect(first?.incident?.incidentId).toBeDefined();
    expect(second?.incident?.incidentId).toBe(first?.incident?.incidentId);
    expect(await store.listIncidents()).toHaveLength(1);
    expect(await store.listEvents({ type: 'mass-incident.opened' })).toHaveLength(1);
  });

  it('не трогает заявку, у которой инцидент уже проставлен в черновике', async () => {
    const store = new MemoryStore();
    await seedSimilar(store, 5);
    const draft: AnalysisDraft = {
      ...currentDraft(),
      incident: { incidentId: 'inc-existing', size: 3, reason: 'уже есть' },
    };

    const patch = await step?.run(context(store, draft));

    expect(patch).toEqual({});
    expect(await store.listIncidents()).toEqual([]);
  });
});

describe('mass-incident: маршруты', () => {
  type CollectedRoute = {
    method: string;
    path: string;
    access: string;
    handler: (ctx: {
      body: unknown;
      params: Record<string, string>;
      query: Record<string, string>;
      user: User;
      deps: ModuleDeps;
    }) => Promise<unknown>;
  };

  function collect(deps: ModuleDeps): CollectedRoute[] {
    const routes: CollectedRoute[] = [];
    const router = {
      add: (route: CollectedRoute) => void routes.push(route),
      get: (path: string, access: string, handler: CollectedRoute['handler']) =>
        void routes.push({ method: 'GET', path, access, handler }),
      post: (path: string, access: string, handler: CollectedRoute['handler']) =>
        void routes.push({ method: 'POST', path, access, handler }),
      patch: () => undefined,
    };
    massIncident.routes?.(router as never, deps);
    return routes;
  }

  const admin: User = {
    id: 'u-admin',
    fullName: 'Администратор',
    role: 'admin',
    departmentId: null,
    position: 'Администратор',
  };

  function moduleDeps(store: MemoryStore, sent: Sent[] = []): ModuleDeps {
    const bus = new KernelEventBus(store);
    const clock = { now: () => NOW };
    return {
      bus,
      ports: makePorts(sent),
      data: makeData(),
      db: store,
      tickets: new TicketService({ store, bus, clock }),
      settings: { get: async () => undefined },
      clock,
    };
  }

  function call(route: CollectedRoute | undefined, deps: ModuleDeps, params: Record<string, string> = {}) {
    if (route === undefined) throw new Error('маршрут не найден');
    return route.handler({ body: {}, params, query: {}, user: admin, deps });
  }

  it('демо-маршрут создаёт шесть заявок и склеивает их в инцидент', async () => {
    const store = new MemoryStore();
    const deps = moduleDeps(store);
    const demo = collect(deps).find((route) => route.method === 'POST' && route.path === '/demo');

    expect(demo?.access).toBe('admin');
    const result = (await call(demo, deps)) as { created: number; incidentId?: string };

    expect(result.created).toBe(6);
    expect(result.incidentId).toBeDefined();

    const incidents = await store.listIncidents();
    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.id).toBe(result.incidentId);
    expect(incidents[0]?.size).toBe(6);

    const tickets = await store.listTickets({ limit: 1000 });
    expect(tickets).toHaveLength(6);
    expect(tickets.every((ticket) => ticket.incidentId === result.incidentId)).toBe(true);
    expect(await store.listEvents({ type: 'mass-incident.opened' })).toHaveLength(1);
  });

  it('список инцидентов отдаёт число привязанных заявок', async () => {
    const store = new MemoryStore();
    const deps = moduleDeps(store);
    const routes = collect(deps);
    const demo = routes.find((route) => route.method === 'POST' && route.path === '/demo');
    const list = routes.find((route) => route.method === 'GET' && route.path === '/incidents');

    await call(demo, deps);
    const result = (await call(list, deps)) as {
      incidents: Array<{ id: string; ticketCount: number }>;
    };

    expect(list?.access).toBe('tickets.read');
    expect(result.incidents).toHaveLength(1);
    expect(result.incidents[0]?.ticketCount).toBe(6);
  });

  it('карточка инцидента отдаёт заявки по времени и падает на неизвестном id', async () => {
    const store = new MemoryStore();
    const deps = moduleDeps(store);
    const routes = collect(deps);
    const demo = routes.find((route) => route.method === 'POST' && route.path === '/demo');
    const detail = routes.find((route) => route.method === 'GET' && route.path === '/incidents/:id');

    const demoResult = (await call(demo, deps)) as { incidentId?: string };
    const result = (await call(detail, deps, { id: demoResult.incidentId ?? '' })) as {
      incident: { id: string };
      tickets: Array<{ incidentId: string | null; createdAt: string }>;
    };

    expect(result.incident.id).toBe(demoResult.incidentId);
    expect(result.tickets).toHaveLength(6);
    expect(result.tickets.every((ticket) => ticket.incidentId === result.incident.id)).toBe(true);
    expect(result.tickets.map((ticket) => ticket.createdAt)).toEqual(
      [...result.tickets.map((ticket) => ticket.createdAt)].sort(),
    );

    await expect(call(detail, deps, { id: 'inc-404' })).rejects.toThrow(/не найден/);
  });
});
