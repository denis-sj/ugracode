import { describe, expect, it } from 'vitest';
import type { Appeal } from '@ugra/contracts';
import { KernelEventBus } from '../src/bus';
import { MemoryStore } from '../src/storage';
import { TicketService } from '../src/tickets';

const clock = { now: () => new Date('2026-11-14T10:00:00.000Z') };

const appeal: Appeal = {
  id: 'a-1',
  channel: 'chat',
  authorId: 'u-applicant-1',
  originalText: 'Корпус Б, кабинет 312',
  attachments: [],
  createdAt: '2026-11-14T10:00:00.000Z',
};

function service(): { tickets: TicketService; store: MemoryStore; bus: KernelEventBus } {
  const store = new MemoryStore();
  const bus = new KernelEventBus(store);
  return { tickets: new TicketService({ store, bus, clock }), store, bus };
}

describe('TicketService', () => {
  it('создаёт черновик с номером и статусом new', async () => {
    const { tickets } = service();
    const ticket = await tickets.createDraft(appeal);
    expect(ticket.status).toBe('new');
    expect(ticket.number).toMatch(/^З-20261114-\d{4}$/);
  });

  it('переносит поля и переводит в in_review', async () => {
    const { tickets, store } = service();
    const ticket = await tickets.createDraft(appeal);
    const updated = await tickets.applyAnalysis(ticket.id, {
      sources: [],
      fields: {
        cabinet: {
          key: 'cabinet',
          value: '312',
          confidence: 0.9,
          quote: { sourceId: 'a-1', text: 'кабинет 312' },
          origin: 'text',
          needsReview: false,
          trace: [],
        },
      },
      missing: [],
      ext: {},
    });
    expect(updated.status).toBe('in_review');
    expect(updated.category).toBeNull();
    const fields = await store.getTicketFields(ticket.id);
    expect(fields[0]?.fieldKey).toBe('cabinet');
    expect(fields[0]?.aiValue).toBe('312');
  });

  it('запрещает переход вне таблицы', async () => {
    const { tickets } = service();
    const ticket = await tickets.createDraft(appeal);
    await expect(tickets.transition(ticket.id, 'closed', { kind: 'user', id: 'u' }, 'applicant')).rejects.toThrow(
      'запрещён',
    );
  });

  it('запрещает переход без нужной роли', async () => {
    const { tickets } = service();
    const ticket = await tickets.createDraft(appeal);
    await expect(tickets.transition(ticket.id, 'ai_draft', { kind: 'user', id: 'u' }, 'applicant')).rejects.toThrow(
      'Роль applicant',
    );
  });

  it('разрешает системный переход', async () => {
    const { tickets } = service();
    const ticket = await tickets.createDraft(appeal);
    const updated = await tickets.transition(ticket.id, 'ai_draft', { kind: 'system' });
    expect(updated.status).toBe('ai_draft');
  });

  it('подтверждает и назначает исполнителя', async () => {
    const { tickets, store } = service();
    const ticket = await tickets.createDraft(appeal);
    await tickets.transition(ticket.id, 'ai_draft', { kind: 'system' });
    await tickets.transition(ticket.id, 'in_review', { kind: 'system' });
    const confirmed = await tickets.confirm(
      ticket.id,
      'u-engineer-1',
      { kind: 'user', id: 'u-dispatcher-1' },
      'dispatcher',
    );
    expect(confirmed.status).toBe('assigned');
    expect(confirmed.assigneeId).toBe('u-engineer-1');
    const events = await store.listEvents({ ticketId: ticket.id });
    expect(events.map((event) => event.type)).toContain('ticket.confirmed');
  });

  it('не подтверждает заявителем', async () => {
    const { tickets } = service();
    const ticket = await tickets.createDraft(appeal);
    await expect(tickets.confirm(ticket.id, 'u-engineer-1', { kind: 'user' }, 'applicant')).rejects.toThrow();
  });

  it('правит поле, сохраняя вариант ИИ', async () => {
    const { tickets } = service();
    const ticket = await tickets.createDraft(appeal);
    await tickets.applyAnalysis(ticket.id, {
      sources: [],
      fields: {
        cabinet: {
          key: 'cabinet',
          value: '312',
          confidence: 0.6,
          quote: null,
          origin: 'text',
          needsReview: true,
          trace: [],
        },
      },
      missing: [],
      ext: {},
    });
    const updated = await tickets.setField(ticket.id, 'cabinet', '313', { kind: 'user', id: 'u-dispatcher-1' });
    expect(updated.value).toBe('313');
    expect(updated.aiValue).toBe('312');
    expect(updated.origin).toBe('human');
  });

  it('сообщает о ненайденном поле и заявке', async () => {
    const { tickets } = service();
    const ticket = await tickets.createDraft(appeal);
    await expect(tickets.setField(ticket.id, 'nope', 'x', { kind: 'user' })).rejects.toThrow('не найдено');
    await expect(tickets.transition('missing', 'ai_draft', { kind: 'system' })).rejects.toThrow('не найдена');
  });
});

describe('сроки и возврат диспетчеру', () => {
  it('продлевает срок решения с причиной', async () => {
    const { tickets, store } = service();
    const ticket = await tickets.createDraft(appeal);
    const updated = await tickets.extendDeadline(
      ticket.id,
      '2026-11-15T12:00:00.000Z',
      'ждём запчасть',
      { kind: 'user', id: 'u-dispatcher-1' },
    );
    expect(updated.slaDueAt).toBe('2026-11-15T12:00:00.000Z');
    const events = await store.listEvents({ ticketId: ticket.id });
    const extended = events.find((event) => event.type === 'ticket.deadline.extended');
    expect(extended?.payload).toMatchObject({ reason: 'ждём запчасть' });
  });

  it('инженер возвращает заявку диспетчеру с причиной', async () => {
    const { tickets, store } = service();
    const ticket = await tickets.createDraft(appeal);
    await tickets.transition(ticket.id, 'ai_draft', { kind: 'system' });
    await tickets.transition(ticket.id, 'in_review', { kind: 'system' });
    await tickets.confirm(ticket.id, 'u-engineer-1', { kind: 'user', id: 'u-dispatcher-1' }, 'dispatcher');
    const returned = await tickets.transition(
      ticket.id,
      'in_review',
      { kind: 'user', id: 'u-engineer-1' },
      'engineer',
      'нужна помощь с доступом',
    );
    expect(returned.status).toBe('in_review');
    const events = await store.listEvents({ ticketId: ticket.id });
    expect(events.map((event) => event.type)).toContain('ticket.returned');
    const changed = events.find(
      (event) =>
        event.type === 'ticket.status.changed' &&
        (event.payload as { to?: string } | undefined)?.to === 'in_review' &&
        (event.payload as { reason?: string } | undefined)?.reason !== undefined,
    );
    expect(changed?.payload).toMatchObject({ reason: 'нужна помощь с доступом' });
  });

  it('не продлевает срок несуществующей заявкой', async () => {
    const { tickets } = service();
    await expect(
      tickets.extendDeadline('missing', '2026-11-15T12:00:00.000Z', 'причина', { kind: 'system' }),
    ).rejects.toThrow('не найдена');
  });
});
