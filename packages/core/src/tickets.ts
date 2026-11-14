import { randomUUID } from 'node:crypto';
import type {
  Actor,
  AnalysisDraft,
  Appeal,
  DomainEvent,
  EventBus,
  FieldDef,
  Role,
  Ticket,
  TicketField,
  TicketStatus,
} from '@ugra/contracts';
import { findTransition, hasPermission } from '@ugra/contracts';
import type { KernelStore } from './storage';
import type { ClockPort } from './ports';

export interface TicketServiceDeps {
  store: KernelStore;
  bus: EventBus;
  clock: ClockPort;
  fields?: readonly FieldDef[];
}

function asText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  return null;
}

/** Единственное место смены статуса и записи полей заявки (раздел 4.1). */
export class TicketService {
  constructor(private readonly deps: TicketServiceDeps) {}

  /** Черновик заявки до разбора: статус `new`. */
  async createDraft(appeal: Appeal): Promise<Ticket> {
    const now = this.deps.clock.now().toISOString();
    const existing = await this.deps.store.listTickets({ limit: 1000 });
    const number = `З-${now.slice(0, 10).replaceAll('-', '')}-${String(existing.length + 1).padStart(4, '0')}`;
    const ticket: Ticket = {
      id: randomUUID(),
      number,
      appealId: appeal.id,
      status: 'new',
      priority: null,
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
      resolution: null,
      resolvedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await this.deps.store.saveTicket(ticket);
    return ticket;
  }

  /** Переносит итог разбора в заявку: поля, колонки для отчётов, статус `in_review`. */
  async applyAnalysis(ticketId: string, draft: AnalysisDraft, actor: Actor = { kind: 'ai' }): Promise<Ticket> {
    const ticket = await this.requireTicket(ticketId);
    const rows: TicketField[] = Object.values(draft.fields).map((field) => ({
      ticketId,
      fieldKey: field.key,
      value: field.value,
      confidence: field.confidence,
      quote: field.quote,
      origin: field.origin,
      needsReview: field.needsReview,
      trace: field.trace,
      aiValue: field.value,
    }));
    await this.deps.store.saveTicketFields(ticketId, rows);
    for (const row of rows) {
      await this.publish('ticket.field.set', actor, ticketId, {
        fieldKey: row.fieldKey,
        value: row.value,
        origin: row.origin,
      });
    }
    const category = asText(draft.fields.category?.value);
    const department = asText(draft.fields.department?.value);
    const patch: Partial<Ticket> = {
      category,
      departmentId: department,
      equipmentId: asText(draft.fields.equipmentId?.value) ?? ticket.equipmentId,
      locationId: asText(draft.fields.locationId?.value) ?? ticket.locationId,
      priority: draft.priority?.value ?? ticket.priority,
      reactDueAt: draft.priority?.reactDueAt ?? ticket.reactDueAt,
      slaDueAt: draft.priority?.slaDueAt ?? ticket.slaDueAt,
      isEmergency: draft.emergency ? draft.emergency.level !== 'none' : false,
      incidentId: draft.incident?.incidentId ?? null,
      updatedAt: this.deps.clock.now().toISOString(),
    };
    await this.deps.store.updateTicket(ticketId, patch);
    let current = ticket;
    if (current.status === 'new') current = await this.transition(ticketId, 'ai_draft', actor);
    // Есть вопросы к заявителю — заявка ждёт ответа, диспетчеру она пока не нужна.
    if (current.status === 'waiting_applicant' && draft.missing.length > 0) return current;
    if (['ai_draft', 'waiting_applicant'].includes(current.status)) {
      return this.transition(ticketId, 'in_review', { kind: 'system' });
    }
    return this.requireTicket(ticketId);
  }

  async transition(
    ticketId: string,
    to: TicketStatus,
    actor: Actor,
    role?: Role,
    reason?: string,
  ): Promise<Ticket> {
    const ticket = await this.requireTicket(ticketId);
    const transition = findTransition(ticket.status, to);
    if (!transition) {
      throw new Error(`Переход ${ticket.status} → ${to} запрещён`);
    }
    if (actor.kind === 'user') {
      if (!role) throw new Error('Для действия пользователя нужна роль');
      if (!transition.roles.includes(role)) throw new Error(`Роль ${role} не может выполнить переход ${ticket.status} → ${to}`);
      if (!hasPermission(role, transition.permission)) throw new Error(`Нет права ${transition.permission}`);
    }
    const now = this.deps.clock.now().toISOString();
    const updated = await this.deps.store.updateTicket(ticketId, {
      status: to,
      resolvedAt: to === 'resolved' ? now : ticket.resolvedAt,
      updatedAt: now,
    });
    if (!updated) throw new Error(`Заявка ${ticketId} не найдена`);
    await this.publish('ticket.status.changed', actor, ticketId, { from: ticket.status, to, reason });
    if (to === 'in_review') {
      await this.publish('ticket.returned', actor, ticketId, { from: ticket.status, reason });
    }
    return updated;
  }

  /** Результат работ инженера и перевод в `resolved` (одним действием). */
  async resolve(
    ticketId: string,
    resolution: string,
    actor: Actor,
    role?: Role,
  ): Promise<Ticket> {
    await this.requireTicket(ticketId);
    await this.deps.store.updateTicket(ticketId, {
      resolution,
      updatedAt: this.deps.clock.now().toISOString(),
    });
    return this.transition(ticketId, 'resolved', actor, role);
  }

  /** Продление срока решения с причиной: событие `ticket.deadline.extended`. */
  async extendDeadline(ticketId: string, newDueAt: string, reason: string, actor: Actor): Promise<Ticket> {
    const ticket = await this.requireTicket(ticketId);
    const updated = await this.deps.store.updateTicket(ticketId, {
      slaDueAt: newDueAt,
      updatedAt: this.deps.clock.now().toISOString(),
    });
    if (!updated) throw new Error(`Заявка ${ticketId} не найдена`);
    await this.publish('ticket.deadline.extended', actor, ticketId, {
      previous: ticket.slaDueAt,
      slaDueAt: newDueAt,
      reason,
    });
    return updated;
  }

  /** Правка поля диспетчером: старый ИИ-вариант остаётся в `aiValue`. */
  async setField(
    ticketId: string,
    fieldKey: string,
    value: string | number | null,
    actor: Actor,
  ): Promise<TicketField> {
    await this.requireTicket(ticketId);
    const updated = await this.deps.store.updateTicketField(ticketId, fieldKey, {
      value,
      origin: 'human',
      confidence: 1,
      needsReview: false,
    });
    if (!updated) throw new Error(`Поле ${fieldKey} не найдено в заявке ${ticketId}`);
    await this.publish('ticket.field.corrected', actor, ticketId, { fieldKey, value, previous: updated.aiValue });
    return updated;
  }

  /** Подтверждение диспетчером и назначение исполнителя — единственный путь в `assigned`. */
  async confirm(ticketId: string, assigneeId: string, actor: Actor, role: Role): Promise<Ticket> {
    if (actor.kind === 'user' && !hasPermission(role, 'tickets.confirm')) {
      throw new Error('Нет права подтверждать заявку');
    }
    const now = this.deps.clock.now().toISOString();
    const ticket = await this.requireTicket(ticketId);
    const transition = findTransition(ticket.status, 'assigned');
    if (!transition || (actor.kind === 'user' && !transition.roles.includes(role))) {
      throw new Error(`Нельзя подтвердить заявку в статусе ${ticket.status}`);
    }
    await this.deps.store.updateTicket(ticketId, {
      assigneeId,
      confirmedBy: actor.id ?? null,
      confirmedAt: now,
      updatedAt: now,
    });
    await this.publish('ticket.confirmed', actor, ticketId, { assigneeId });
    await this.publish('ticket.assigned', actor, ticketId, { assigneeId });
    return this.transition(ticketId, 'assigned', actor, role);
  }

  private async requireTicket(ticketId: string): Promise<Ticket> {
    const ticket = await this.deps.store.getTicket(ticketId);
    if (!ticket) throw new Error(`Заявка ${ticketId} не найдена`);
    return ticket;
  }

  private async publish(
    type: string,
    actor: Actor,
    ticketId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const event: Omit<DomainEvent, 'id' | 'at'> = { type, actor, ticketId, payload };
    await this.deps.bus.publish(event);
  }
}

export interface SettingsService {
  get<T = unknown>(key: string): Promise<T | undefined>;
  list(): Promise<Record<string, unknown>>;
}

export function createSettingsService(data: { settings: Record<string, unknown> }): SettingsService {
  return {
    async get<T = unknown>(key: string): Promise<T | undefined> {
      return data.settings[key] as T | undefined;
    },
    async list(): Promise<Record<string, unknown>> {
      return { ...data.settings };
    },
  };
}
