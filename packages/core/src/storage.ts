import type {
  Appeal,
  DomainEvent,
  PipelineRun,
  SettingRecord,
  StepRun,
  Ticket,
  TicketField,
  TicketStatus,
  User,
  UserNotification,
} from '@ugra/contracts';

export interface TicketFilter {
  status?: TicketStatus;
  assigneeId?: string;
  isEmergency?: boolean;
  limit?: number;
}

export interface EventFilter {
  ticketId?: string;
  type?: string;
  limit?: number;
}

/** Хранилище ядра. Реализации: память (тесты) и PostgreSQL (`@ugra/db`). */
export interface KernelStore {
  listUsers(): Promise<User[]>;
  getUser(id: string): Promise<User | null>;
  saveUser(user: User): Promise<void>;

  saveAppeal(appeal: Appeal): Promise<void>;
  getAppeal(id: string): Promise<Appeal | null>;

  saveTicket(ticket: Ticket): Promise<void>;
  updateTicket(id: string, patch: Partial<Ticket>): Promise<Ticket | null>;
  getTicket(id: string): Promise<Ticket | null>;
  listTickets(filter?: TicketFilter): Promise<Ticket[]>;

  saveTicketFields(ticketId: string, fields: TicketField[]): Promise<void>;
  updateTicketField(ticketId: string, fieldKey: string, patch: Partial<TicketField>): Promise<TicketField | null>;
  getTicketFields(ticketId: string): Promise<TicketField[]>;

  savePipelineRun(run: PipelineRun): Promise<void>;
  savePipelineStep(step: StepRun): Promise<void>;
  listPipelineSteps(filter: { runId?: string; ticketId?: string }): Promise<StepRun[]>;

  appendEvent(event: DomainEvent): Promise<void>;
  listEvents(filter?: EventFilter): Promise<DomainEvent[]>;

  saveNotification(notification: UserNotification): Promise<void>;
  listNotifications(userId?: string): Promise<UserNotification[]>;
  markNotificationRead(id: string, userId: string): Promise<UserNotification | null>;

  listSettings(): Promise<SettingRecord[]>;
  setSetting(key: string, value: unknown, updatedBy: string | null): Promise<SettingRecord>;
}

/** Хранилище в памяти: тесты, тест-контракт и демо без базы. */
export class MemoryStore implements KernelStore {
  private readonly users = new Map<string, User>();
  private readonly appeals = new Map<string, Appeal>();
  private readonly tickets = new Map<string, Ticket>();
  private readonly fields = new Map<string, TicketField[]>();
  private readonly runs = new Map<string, PipelineRun>();
  private readonly steps: StepRun[] = [];
  private readonly events: DomainEvent[] = [];
  private readonly notifications = new Map<string, UserNotification>();
  private readonly settings = new Map<string, SettingRecord>();

  async listUsers(): Promise<User[]> {
    return [...this.users.values()];
  }

  async getUser(id: string): Promise<User | null> {
    return this.users.get(id) ?? null;
  }

  async saveUser(user: User): Promise<void> {
    this.users.set(user.id, user);
  }

  async saveAppeal(appeal: Appeal): Promise<void> {
    this.appeals.set(appeal.id, appeal);
  }

  async getAppeal(id: string): Promise<Appeal | null> {
    return this.appeals.get(id) ?? null;
  }

  async saveTicket(ticket: Ticket): Promise<void> {
    this.tickets.set(ticket.id, ticket);
  }

  async updateTicket(id: string, patch: Partial<Ticket>): Promise<Ticket | null> {
    const current = this.tickets.get(id);
    if (!current) return null;
    const next = { ...current, ...patch, id };
    this.tickets.set(id, next);
    return next;
  }

  async getTicket(id: string): Promise<Ticket | null> {
    return this.tickets.get(id) ?? null;
  }

  async listTickets(filter: TicketFilter = {}): Promise<Ticket[]> {
    let result = [...this.tickets.values()];
    if (filter.status) result = result.filter((t) => t.status === filter.status);
    if (filter.assigneeId) result = result.filter((t) => t.assigneeId === filter.assigneeId);
    if (filter.isEmergency !== undefined) result = result.filter((t) => t.isEmergency === filter.isEmergency);
    return result.slice(0, filter.limit ?? 50);
  }

  async saveTicketFields(ticketId: string, fields: TicketField[]): Promise<void> {
    this.fields.set(ticketId, fields);
  }

  async updateTicketField(
    ticketId: string,
    fieldKey: string,
    patch: Partial<TicketField>,
  ): Promise<TicketField | null> {
    const list = this.fields.get(ticketId) ?? [];
    const index = list.findIndex((field) => field.fieldKey === fieldKey);
    if (index < 0) return null;
    const current = list[index];
    if (!current) return null;
    const next = { ...current, ...patch, ticketId, fieldKey };
    list[index] = next;
    return next;
  }

  async getTicketFields(ticketId: string): Promise<TicketField[]> {
    return this.fields.get(ticketId) ?? [];
  }

  async savePipelineRun(run: PipelineRun): Promise<void> {
    this.runs.set(run.id, run);
  }

  async savePipelineStep(step: StepRun): Promise<void> {
    this.steps.push(step);
  }

  async listPipelineSteps(filter: { runId?: string; ticketId?: string }): Promise<StepRun[]> {
    return this.steps.filter(
      (step) =>
        (!filter.runId || step.runId === filter.runId) &&
        (!filter.ticketId || step.ticketId === filter.ticketId),
    );
  }

  async appendEvent(event: DomainEvent): Promise<void> {
    this.events.push(event);
  }

  async listEvents(filter: EventFilter = {}): Promise<DomainEvent[]> {
    let result = this.events;
    if (filter.ticketId) result = result.filter((e) => e.ticketId === filter.ticketId);
    if (filter.type) result = result.filter((e) => e.type === filter.type);
    return filter.limit ? result.slice(-filter.limit) : result;
  }

  async saveNotification(notification: UserNotification): Promise<void> {
    this.notifications.set(notification.id, notification);
  }

  async listNotifications(userId?: string): Promise<UserNotification[]> {
    return [...this.notifications.values()].filter((item) => !userId || item.toUserId === userId);
  }

  async markNotificationRead(id: string, userId: string): Promise<UserNotification | null> {
    const current = this.notifications.get(id);
    if (!current || current.toUserId !== userId) return null;
    const next = { ...current, readAt: new Date().toISOString() };
    this.notifications.set(id, next);
    return next;
  }

  async listSettings(): Promise<SettingRecord[]> {
    return [...this.settings.values()];
  }

  async setSetting(key: string, value: unknown, updatedBy: string | null): Promise<SettingRecord> {
    const record: SettingRecord = { key, value, updatedBy, updatedAt: new Date().toISOString() };
    this.settings.set(key, record);
    return record;
  }
}
