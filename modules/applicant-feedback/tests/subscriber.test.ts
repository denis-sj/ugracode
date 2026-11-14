import { describe, expect, it } from 'vitest';
import type { Appeal, DomainEvent, Ticket, User } from '@ugra/contracts';
import type { ModuleDeps, Ports } from '@ugra/core';
import { createReferenceData, KernelEventBus, MemoryStore, TicketService } from '@ugra/core';
import applicantFeedback from '../server';

const NOW = new Date(2026, 10, 14, 10, 0, 0);

const applicant: User = {
  id: 'u-applicant',
  fullName: 'Тестовый Заявитель',
  role: 'applicant',
  departmentId: null,
  position: 'Инженер',
};

const engineer: User = {
  id: 'u-engineer',
  fullName: 'Иван Петров',
  role: 'engineer',
  departmentId: 'dep-it',
  position: 'Инженер',
};

const dispatcher: User = {
  id: 'u-dispatcher',
  fullName: 'Диспетчер',
  role: 'dispatcher',
  departmentId: 'dep-service',
  position: 'Диспетчер',
};

const appeal: Appeal = {
  id: 'appeal-1',
  channel: 'chat',
  authorId: applicant.id,
  originalText: 'Принтер не печатает',
  attachments: [],
  createdAt: NOW.toISOString(),
};

const data = createReferenceData({
  dictionaries: [{ dictionary: 'priority', code: 'high', label: 'Высокий' }],
});

function ticket(patch: Partial<Ticket> = {}): Ticket {
  const base: Ticket = {
    id: 'ticket-1',
    number: 'З-20261114-0001',
    appealId: appeal.id,
    status: 'assigned',
    priority: 'high',
    category: 'printer',
    departmentId: 'dep-it',
    assigneeId: engineer.id,
    isEmergency: false,
    incidentId: null,
    reactDueAt: null,
    slaDueAt: new Date(NOW.getTime() + 8 * 60 * 60_000).toISOString(),
    equipmentId: null,
    locationId: null,
    confirmedBy: dispatcher.id,
    confirmedAt: NOW.toISOString(),
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
  };
  return { ...base, ...patch } as Ticket;
}

interface SentNotification {
  toUserId: string;
  title: string;
  body: string;
}

function makePorts(sent: SentNotification[], failSend = false): Ports {
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
      send: async (notification) => {
        if (failSend) throw new Error('канал недоступен');
        sent.push({ toUserId: notification.toUserId, title: notification.title, body: notification.body });
        return { delivered: true };
      },
    },
    clock: { now: () => NOW },
  };
}

function makeDeps(store: MemoryStore, ports: Ports): ModuleDeps {
  const bus = new KernelEventBus(store);
  return {
    bus,
    ports,
    data,
    db: store,
    tickets: new TicketService({ store, bus, clock: ports.clock }),
    settings: {
      async get<T = unknown>(): Promise<T | undefined> {
        return undefined;
      },
    },
    clock: ports.clock,
  };
}

async function seededStore(): Promise<MemoryStore> {
  const store = new MemoryStore();
  await store.saveUser(applicant);
  await store.saveUser(engineer);
  await store.saveUser(dispatcher);
  await store.saveAppeal(appeal);
  await store.saveTicket(ticket());
  return store;
}

function confirmedEvent(patch: Partial<DomainEvent> = {}): DomainEvent {
  return {
    id: 'event-1',
    type: 'ticket.confirmed',
    at: NOW.toISOString(),
    actor: { kind: 'user', id: dispatcher.id },
    ticketId: 'ticket-1',
    payload: { assigneeId: engineer.id },
    ...patch,
  };
}

describe('applicant-feedback: подписчик ticket.confirmed', () => {
  it('пишет сообщение заявителю, уведомление и отдаёт его порту', async () => {
    const store = await seededStore();
    const sent: SentNotification[] = [];
    const deps = makeDeps(store, makePorts(sent));

    await applicantFeedback.subscribers[0]?.handle(confirmedEvent(), deps);

    const messages = await store.listAppealMessages(appeal.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.direction).toBe('out');
    expect(messages[0]?.kind).toBe('text');
    expect(messages[0]?.body).toContain('Заявка № З-20261114-0001 принята');
    expect(messages[0]?.body).toContain('Исполнитель — Иван Петров.');

    const notifications = await store.listNotifications(applicant.id);
    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.title).toBe('Заявка № З-20261114-0001 принята');
    expect(sent).toHaveLength(1);
    expect(sent[0]?.toUserId).toBe(applicant.id);

    const events = await store.listEvents({ ticketId: 'ticket-1' });
    expect(events.map((event) => event.type)).toContain('message.sent');
  });

  it('ошибка канала уведомлений не валит подтверждение и не мешает сообщению', async () => {
    const store = await seededStore();
    const deps = makeDeps(store, makePorts([], true));

    await expect(applicantFeedback.subscribers[0]?.handle(confirmedEvent(), deps)).resolves.toBeUndefined();

    expect(await store.listAppealMessages(appeal.id)).toHaveLength(1);
  });

  it('заявки нет — подписчик молчит и не бросает', async () => {
    const store = await seededStore();
    const sent: SentNotification[] = [];
    const deps = makeDeps(store, makePorts(sent));

    await expect(
      applicantFeedback.subscribers[0]?.handle(confirmedEvent({ ticketId: 'нет-такой' }), deps),
    ).resolves.toBeUndefined();
    await expect(
      applicantFeedback.subscribers[0]?.handle(confirmedEvent({ ticketId: undefined }), deps),
    ).resolves.toBeUndefined();
    expect(sent).toHaveLength(0);
  });
});

interface CapturedRoute {
  method: string;
  path: string;
  access: string;
  handler: (ctx: unknown) => Promise<unknown>;
}

function capturedRoutes(): CapturedRoute[] {
  const routes: CapturedRoute[] = [];
  const push =
    (method: string) =>
    (path: string, access: string, handler: (ctx: unknown) => Promise<unknown>): void => {
      routes.push({ method, path, access, handler });
    };
  const router = {
    add: () => undefined,
    get: push('GET'),
    post: push('POST'),
    patch: push('PATCH'),
  };
  const store = new MemoryStore();
  applicantFeedback.routes?.(router as never, makeDeps(store, makePorts([])));
  return routes;
}

describe('applicant-feedback: маршрут ответа диспетчера', () => {
  it('объявляет право tickets.edit и сохраняет исходящее сообщение', async () => {
    const store = await seededStore();
    const deps = makeDeps(store, makePorts([]));
    const route = capturedRoutes().find((item) => item.path === '/tickets/:id/reply');

    expect(route?.method).toBe('POST');
    expect(route?.access).toBe('tickets.edit');

    const result = (await route?.handler({
      body: { text: '  Инженер уже в пути.  ' },
      params: { id: 'ticket-1' },
      query: {},
      user: dispatcher,
      deps,
    })) as { message: { direction: string; body: string }; ticketId: string };

    expect(result.ticketId).toBe('ticket-1');
    expect(result.message.direction).toBe('out');
    expect(result.message.body).toBe('Инженер уже в пути.');

    const messages = await store.listAppealMessages(appeal.id);
    expect(messages.at(-1)?.body).toBe('Инженер уже в пути.');
    const events = await store.listEvents({ ticketId: 'ticket-1' });
    expect(events.map((event) => event.type)).toContain('applicant-feedback.message.sent');
  });

  it('пустой текст и чужая заявка — ошибки со статусом', async () => {
    const store = await seededStore();
    const deps = makeDeps(store, makePorts([]));
    const route = capturedRoutes().find((item) => item.path === '/tickets/:id/reply');
    const call = (body: unknown, id: string): Promise<unknown> =>
      route?.handler({ body, params: { id }, query: {}, user: dispatcher, deps }) ?? Promise.resolve();

    await expect(call({ text: '   ' }, 'ticket-1')).rejects.toMatchObject({ statusCode: 400 });
    await expect(call({}, 'ticket-1')).rejects.toMatchObject({ statusCode: 400 });
    await expect(call({ text: 'Ответ' }, 'нет-такой')).rejects.toMatchObject({ statusCode: 404 });
  });
});
