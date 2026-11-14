import { and, asc, desc, eq, type SQL } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type {
  Appeal,
  DomainEvent,
  PipelineRun,
  SettingRecord,
  StepRun,
  Ticket,
  TicketField,
  User,
  UserNotification,
} from '@ugra/contracts';
import type { EventFilter, KernelStore, TicketFilter } from '@ugra/core';
import {
  mapAppealRow,
  mapEventLogRow,
  mapPipelineStepRow,
  mapTicketFieldRow,
  mapTicketRow,
  mapUserRow,
  toIso,
  toIsoOrNull,
} from './mappers';
import {
  appealTable,
  eventLogTable,
  notificationTable,
  settingTable,
  pipelineRunTable,
  pipelineStepTable,
  schema,
  ticketFieldTable,
  ticketTable,
  userTable,
} from './schema';

export const DEFAULT_DATABASE_URL = 'postgres://ugra:ugra@localhost:5432/ugra';

type Database = NodePgDatabase<typeof schema>;
type TicketInsert = typeof ticketTable.$inferInsert;
type TicketFieldInsert = typeof ticketFieldTable.$inferInsert;

function ticketToInsert(ticket: Ticket): TicketInsert {
  return {
    id: ticket.id,
    number: ticket.number,
    appealId: ticket.appealId,
    status: ticket.status,
    priority: ticket.priority,
    category: ticket.category,
    departmentId: ticket.departmentId,
    assigneeId: ticket.assigneeId,
    isEmergency: ticket.isEmergency,
    incidentId: ticket.incidentId,
    slaDueAt: ticket.slaDueAt,
    confirmedBy: ticket.confirmedBy,
    confirmedAt: ticket.confirmedAt,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
  };
}

/** Частичное обновление: берём только заданные ключи, `null` — осознанное значение. */
function ticketToPatch(patch: Partial<Ticket>): Partial<TicketInsert> {
  const row: Partial<TicketInsert> = {};
  if (patch.number !== undefined) row.number = patch.number;
  if (patch.appealId !== undefined) row.appealId = patch.appealId;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.priority !== undefined) row.priority = patch.priority;
  if (patch.category !== undefined) row.category = patch.category;
  if (patch.departmentId !== undefined) row.departmentId = patch.departmentId;
  if (patch.assigneeId !== undefined) row.assigneeId = patch.assigneeId;
  if (patch.isEmergency !== undefined) row.isEmergency = patch.isEmergency;
  if (patch.incidentId !== undefined) row.incidentId = patch.incidentId;
  if (patch.slaDueAt !== undefined) row.slaDueAt = patch.slaDueAt;
  if (patch.confirmedBy !== undefined) row.confirmedBy = patch.confirmedBy;
  if (patch.confirmedAt !== undefined) row.confirmedAt = patch.confirmedAt;
  if (patch.createdAt !== undefined) row.createdAt = patch.createdAt;
  if (patch.updatedAt !== undefined) row.updatedAt = patch.updatedAt;
  return row;
}

function ticketFieldToInsert(field: TicketField): TicketFieldInsert {
  return {
    ticketId: field.ticketId,
    fieldKey: field.fieldKey,
    value: field.value,
    confidence: field.confidence,
    quote: field.quote,
    origin: field.origin,
    needsReview: field.needsReview,
    trace: field.trace,
    aiValue: field.aiValue,
  };
}

function ticketFieldToPatch(patch: Partial<TicketField>): Partial<TicketFieldInsert> {
  const row: Partial<TicketFieldInsert> = {};
  if (patch.value !== undefined) row.value = patch.value;
  if (patch.confidence !== undefined) row.confidence = patch.confidence;
  if (patch.quote !== undefined) row.quote = patch.quote;
  if (patch.origin !== undefined) row.origin = patch.origin;
  if (patch.needsReview !== undefined) row.needsReview = patch.needsReview;
  if (patch.trace !== undefined) row.trace = patch.trace;
  if (patch.aiValue !== undefined) row.aiValue = patch.aiValue;
  return row;
}

/** PostgreSQL-хранилище ядра. */
export class PgStore implements KernelStore {
  constructor(private readonly db: Database) {}

  async listUsers(): Promise<User[]> {
    const rows = await this.db.select().from(userTable).orderBy(asc(userTable.fullName));
    return rows.map(mapUserRow);
  }

  async getUser(id: string): Promise<User | null> {
    const rows = await this.db.select().from(userTable).where(eq(userTable.id, id)).limit(1);
    const row = rows[0];
    return row ? mapUserRow(row) : null;
  }

  async saveUser(user: User): Promise<void> {
    await this.db
      .insert(userTable)
      .values({
        id: user.id,
        fullName: user.fullName,
        role: user.role,
        departmentId: user.departmentId,
        position: user.position,
      })
      .onConflictDoUpdate({
        target: userTable.id,
        set: {
          fullName: user.fullName,
          role: user.role,
          departmentId: user.departmentId,
          position: user.position,
        },
      });
  }

  async saveAppeal(appeal: Appeal): Promise<void> {
    await this.db
      .insert(appealTable)
      .values({
        id: appeal.id,
        channel: appeal.channel,
        authorId: appeal.authorId,
        originalText: appeal.originalText,
        attachments: appeal.attachments,
        createdAt: appeal.createdAt,
      })
      .onConflictDoUpdate({
        target: appealTable.id,
        set: {
          channel: appeal.channel,
          authorId: appeal.authorId,
          originalText: appeal.originalText,
          attachments: appeal.attachments,
          createdAt: appeal.createdAt,
        },
      });
  }

  async getAppeal(id: string): Promise<Appeal | null> {
    const rows = await this.db.select().from(appealTable).where(eq(appealTable.id, id)).limit(1);
    const row = rows[0];
    return row ? mapAppealRow(row) : null;
  }

  async saveTicket(ticket: Ticket): Promise<void> {
    const insert = ticketToInsert(ticket);
    const { id: _id, ...rest } = insert;
    await this.db
      .insert(ticketTable)
      .values(insert)
      .onConflictDoUpdate({ target: ticketTable.id, set: rest });
  }

  async updateTicket(id: string, patch: Partial<Ticket>): Promise<Ticket | null> {
    const row = ticketToPatch(patch);
    if (Object.keys(row).length === 0) return this.getTicket(id);
    const updated = await this.db
      .update(ticketTable)
      .set(row)
      .where(eq(ticketTable.id, id))
      .returning();
    const first = updated[0];
    return first ? mapTicketRow(first) : null;
  }

  async getTicket(id: string): Promise<Ticket | null> {
    const rows = await this.db.select().from(ticketTable).where(eq(ticketTable.id, id)).limit(1);
    const row = rows[0];
    return row ? mapTicketRow(row) : null;
  }

  async listTickets(filter: TicketFilter = {}): Promise<Ticket[]> {
    const conditions: SQL[] = [];
    if (filter.status) conditions.push(eq(ticketTable.status, filter.status));
    if (filter.assigneeId) conditions.push(eq(ticketTable.assigneeId, filter.assigneeId));
    if (filter.isEmergency !== undefined) conditions.push(eq(ticketTable.isEmergency, filter.isEmergency));
    const rows = await this.db
      .select()
      .from(ticketTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(ticketTable.createdAt))
      .limit(filter.limit ?? 50);
    return rows.map(mapTicketRow);
  }

  async saveTicketFields(ticketId: string, fields: TicketField[]): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(ticketFieldTable).where(eq(ticketFieldTable.ticketId, ticketId));
      if (fields.length === 0) return;
      await tx.insert(ticketFieldTable).values(fields.map(ticketFieldToInsert));
    });
  }

  async updateTicketField(
    ticketId: string,
    fieldKey: string,
    patch: Partial<TicketField>,
  ): Promise<TicketField | null> {
    const row = ticketFieldToPatch(patch);
    const where = and(eq(ticketFieldTable.ticketId, ticketId), eq(ticketFieldTable.fieldKey, fieldKey));
    if (Object.keys(row).length === 0) {
      const rows = await this.db.select().from(ticketFieldTable).where(where).limit(1);
      const first = rows[0];
      return first ? mapTicketFieldRow(first) : null;
    }
    const updated = await this.db.update(ticketFieldTable).set(row).where(where).returning();
    const first = updated[0];
    return first ? mapTicketFieldRow(first) : null;
  }

  async getTicketFields(ticketId: string): Promise<TicketField[]> {
    const rows = await this.db
      .select()
      .from(ticketFieldTable)
      .where(eq(ticketFieldTable.ticketId, ticketId))
      .orderBy(asc(ticketFieldTable.fieldKey));
    return rows.map(mapTicketFieldRow);
  }

  async savePipelineRun(run: PipelineRun): Promise<void> {
    const insert = {
      id: run.id,
      ticketId: run.ticketId,
      appealId: run.appealId,
      mode: run.mode,
      status: run.status,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
    };
    const { id: _id, ...rest } = insert;
    await this.db
      .insert(pipelineRunTable)
      .values(insert)
      .onConflictDoUpdate({ target: pipelineRunTable.id, set: rest });
  }

  async savePipelineStep(step: StepRun): Promise<void> {
    await this.db.insert(pipelineStepTable).values({
      runId: step.runId,
      stepId: step.stepId,
      stage: step.stage,
      status: step.status,
      durationMs: Math.round(step.durationMs),
      ticketId: step.ticketId ?? null,
      input: step.input,
      output: step.output,
      error: step.error ?? null,
      model: step.model ?? null,
      promptVersion: step.promptVersion ?? null,
    });
  }

  async listPipelineSteps(filter: { runId?: string; ticketId?: string }): Promise<StepRun[]> {
    const conditions: SQL[] = [];
    if (filter.runId) conditions.push(eq(pipelineStepTable.runId, filter.runId));
    if (filter.ticketId) conditions.push(eq(pipelineStepTable.ticketId, filter.ticketId));
    const rows = await this.db
      .select()
      .from(pipelineStepTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(asc(pipelineStepTable.createdAt));
    return rows.map(mapPipelineStepRow);
  }

  async appendEvent(event: DomainEvent): Promise<void> {
    await this.db
      .insert(eventLogTable)
      .values({
        id: event.id,
        type: event.type,
        at: event.at,
        actorKind: event.actor.kind,
        actorId: event.actor.id ?? null,
        ticketId: event.ticketId ?? null,
        payload: event.payload,
      })
      .onConflictDoNothing({ target: eventLogTable.id });
  }

  async listEvents(filter: EventFilter = {}): Promise<DomainEvent[]> {
    const conditions: SQL[] = [];
    if (filter.ticketId) conditions.push(eq(eventLogTable.ticketId, filter.ticketId));
    if (filter.type) conditions.push(eq(eventLogTable.type, filter.type));
    const rows = await this.db
      .select()
      .from(eventLogTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(eventLogTable.at))
      .limit(filter.limit ?? 1000);
    const mapped = rows.map(mapEventLogRow);
    return mapped.reverse();
  }

  async saveNotification(notification: UserNotification): Promise<void> {
    await this.db
      .insert(notificationTable)
      .values({
        id: notification.id,
        toUserId: notification.toUserId,
        channel: notification.channel,
        title: notification.title,
        body: notification.body,
        ticketId: notification.ticketId,
        readAt: notification.readAt,
        createdAt: notification.createdAt,
      })
      .onConflictDoNothing({ target: notificationTable.id });
  }

  async listNotifications(userId?: string): Promise<UserNotification[]> {
    const rows = await this.db
      .select()
      .from(notificationTable)
      .where(userId ? eq(notificationTable.toUserId, userId) : undefined)
      .orderBy(desc(notificationTable.createdAt));
    return rows.map((row) => ({
      id: row.id,
      toUserId: row.toUserId,
      channel: row.channel as UserNotification['channel'],
      title: row.title,
      body: row.body,
      ticketId: row.ticketId,
      readAt: toIsoOrNull(row.readAt),
      createdAt: toIso(row.createdAt),
    }));
  }

  async markNotificationRead(id: string, userId: string): Promise<UserNotification | null> {
    const rows = await this.db
      .update(notificationTable)
      .set({ readAt: new Date().toISOString() })
      .where(and(eq(notificationTable.id, id), eq(notificationTable.toUserId, userId)))
      .returning();
    const row = rows[0];
    if (!row) return null;
    return {
      id: row.id,
      toUserId: row.toUserId,
      channel: row.channel as UserNotification['channel'],
      title: row.title,
      body: row.body,
      ticketId: row.ticketId,
      readAt: toIsoOrNull(row.readAt),
      createdAt: toIso(row.createdAt),
    };
  }

  async listSettings(): Promise<SettingRecord[]> {
    const rows = await this.db.select().from(settingTable).orderBy(asc(settingTable.key));
    return rows.map((row) => ({
      key: row.key,
      value: row.value,
      updatedBy: row.updatedBy,
      updatedAt: toIso(row.updatedAt),
    }));
  }

  async setSetting(key: string, value: unknown, updatedBy: string | null): Promise<SettingRecord> {
    const rows = await this.db
      .insert(settingTable)
      .values({ key, value, updatedBy, updatedAt: new Date().toISOString() })
      .onConflictDoUpdate({
        target: settingTable.key,
        set: { value, updatedBy, updatedAt: new Date().toISOString() },
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error(`Не удалось сохранить настройку ${key}`);
    return {
      key: row.key,
      value: row.value,
      updatedBy: row.updatedBy,
      updatedAt: toIso(row.updatedAt),
    };
  }
}

export interface PgStoreHandle {
  store: KernelStore;
  close(): Promise<void>;
}

/** Создаёт хранилище на пуле соединений. `close()` закрывает пул. */
export function createPgStore(connectionString = process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL): PgStoreHandle {
  const pool = new Pool({ connectionString });
  const db = drizzle(pool, { schema });
  return {
    store: new PgStore(db),
    close: async () => {
      await pool.end();
    },
  };
}
