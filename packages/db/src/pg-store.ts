import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type {
  Appeal,
  AppealMessage,
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
import type { AgentStepRecord } from '@ugra/core';
import type {
  ApplicantEquipment,
  ApplicantProfile,
  Incident,
  IncidentFilter,
  KnowledgeArticle,
  KnowledgeSearchQuery,
  KnowledgeSimilarTicket,
  SimilarTicketQuery,
} from '@ugra/core';
import { DEFAULT_KNOWLEDGE_LIMIT } from '@ugra/core';
import {
  mapAgentStepRow,
  mapAppealMessageRow,
  mapAppealRow,
  mapApplicantEquipmentRow,
  mapApplicantProfileRow,
  mapEventLogRow,
  mapIncidentRow,
  mapKbArticleRow,
  mapPipelineStepRow,
  mapTicketFieldRow,
  mapTicketRow,
  mapUserRow,
  toIso,
  toIsoOrNull,
} from './mappers';
import {
  agentStepTable,
  appealMessageTable,
  applicantEquipmentTable,
  applicantProfileTable,
  appealTable,
  eventLogTable,
  incidentTable,
  kbArticleTable,
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
type IncidentInsert = typeof incidentTable.$inferInsert;

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
    reactDueAt: ticket.reactDueAt,
    slaDueAt: ticket.slaDueAt,
    equipmentId: ticket.equipmentId,
    locationId: ticket.locationId,
    confirmedBy: ticket.confirmedBy,
    confirmedAt: ticket.confirmedAt,
    resolution: ticket.resolution,
    resolvedAt: ticket.resolvedAt,
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
  if (patch.reactDueAt !== undefined) row.reactDueAt = patch.reactDueAt;
  if (patch.slaDueAt !== undefined) row.slaDueAt = patch.slaDueAt;
  if (patch.equipmentId !== undefined) row.equipmentId = patch.equipmentId;
  if (patch.locationId !== undefined) row.locationId = patch.locationId;
  if (patch.confirmedBy !== undefined) row.confirmedBy = patch.confirmedBy;
  if (patch.confirmedAt !== undefined) row.confirmedAt = patch.confirmedAt;
  if (patch.resolution !== undefined) row.resolution = patch.resolution;
  if (patch.resolvedAt !== undefined) row.resolvedAt = patch.resolvedAt;
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

function incidentToInsert(incident: Incident): IncidentInsert {
  return {
    id: incident.id,
    number: incident.number,
    status: incident.status,
    category: incident.category,
    building: incident.building,
    system: incident.system,
    size: incident.size,
    priority: incident.priority,
    openedAt: incident.openedAt,
    closedAt: incident.closedAt,
  };
}

function incidentToPatch(patch: Partial<Incident>): Partial<IncidentInsert> {
  const row: Partial<IncidentInsert> = {};
  if (patch.number !== undefined) row.number = patch.number;
  if (patch.status !== undefined) row.status = patch.status;
  if (patch.category !== undefined) row.category = patch.category;
  if (patch.building !== undefined) row.building = patch.building;
  if (patch.system !== undefined) row.system = patch.system;
  if (patch.size !== undefined) row.size = patch.size;
  if (patch.priority !== undefined) row.priority = patch.priority;
  if (patch.openedAt !== undefined) row.openedAt = patch.openedAt;
  if (patch.closedAt !== undefined) row.closedAt = patch.closedAt;
  return row;
}

/** jsonb-массив из базы → строки: `pg` может вернуть и массив, и JSON-строку. */
function toTextArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value);
      return Array.isArray(parsed)
        ? parsed.filter((item): item is string => typeof item === 'string')
        : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** `ts_rank` приходит числом или строкой — приводим к числу с тремя знаками. */
function toScore(value: unknown): number {
  const parsed = typeof value === 'string' ? Number(value) : value;
  if (typeof parsed !== 'number' || Number.isNaN(parsed)) return 0;
  return Math.round(parsed * 1000) / 1000;
}

function normalizeLimit(limit: number | undefined): number {
  return Math.max(1, Math.min(limit ?? DEFAULT_KNOWLEDGE_LIMIT, 50));
}

type KbSearchRow = {
  id: string;
  title: string;
  symptoms: unknown;
  steps: unknown;
  solution: string;
  category: string | null;
  score: unknown;
};

type SimilarTicketRow = {
  id: string;
  number: string;
  status: string;
  title: string;
  score: unknown;
};

/** PostgreSQL-хранилище ядра. */
export class PgStore implements KernelStore {  constructor(private readonly db: Database) {}

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

  async getApplicantProfile(userId: string): Promise<ApplicantProfile | null> {
    const rows = await this.db
      .select()
      .from(applicantProfileTable)
      .where(eq(applicantProfileTable.userId, userId))
      .limit(1);
    const row = rows[0];
    return row ? mapApplicantProfileRow(row) : null;
  }

  async saveApplicantProfile(profile: ApplicantProfile): Promise<void> {
    const row = {
      userId: profile.userId,
      building: profile.building,
      floor: profile.floor,
      cabinet: profile.cabinet,
      equipmentId: profile.equipmentId,
      updatedAt: profile.updatedAt ?? new Date().toISOString(),
    };
    const { userId: _userId, ...rest } = row;
    await this.db
      .insert(applicantProfileTable)
      .values(row)
      .onConflictDoUpdate({ target: applicantProfileTable.userId, set: rest });
  }

  async listApplicantEquipment(userId: string): Promise<ApplicantEquipment[]> {
    const rows = await this.db
      .select()
      .from(applicantEquipmentTable)
      .where(eq(applicantEquipmentTable.userId, userId))
      .orderBy(asc(applicantEquipmentTable.id));
    return rows.map(mapApplicantEquipmentRow);
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

  /** Сообщение чата: повторная запись с тем же id обновляет текст и карточку. */
  async saveAppealMessage(message: AppealMessage): Promise<void> {
    const values = {
      id: message.id,
      appealId: message.appealId,
      direction: message.direction,
      kind: message.kind,
      body: message.body,
      fieldKey: message.fieldKey,
      card: message.card ?? null,
      createdAt: message.createdAt,
    };
    const { id: _id, ...rest } = values;
    await this.db
      .insert(appealMessageTable)
      .values(values)
      .onConflictDoUpdate({ target: appealMessageTable.id, set: rest });
  }

  async listAppealMessages(appealId: string): Promise<AppealMessage[]> {
    const rows = await this.db
      .select()
      .from(appealMessageTable)
      .where(eq(appealMessageTable.appealId, appealId))
      .orderBy(asc(appealMessageTable.createdAt), asc(appealMessageTable.id));
    return rows.map(mapAppealMessageRow);
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

  async saveIncident(incident: Incident): Promise<void> {
    const insert = incidentToInsert(incident);
    const { id: _id, ...rest } = insert;
    await this.db
      .insert(incidentTable)
      .values(insert)
      .onConflictDoUpdate({ target: incidentTable.id, set: rest });
  }

  async getIncident(id: string): Promise<Incident | null> {
    const rows = await this.db.select().from(incidentTable).where(eq(incidentTable.id, id)).limit(1);
    const row = rows[0];
    return row ? mapIncidentRow(row) : null;
  }

  async listIncidents(filter: IncidentFilter = {}): Promise<Incident[]> {
    const conditions: SQL[] = [];
    if (filter.status) conditions.push(eq(incidentTable.status, filter.status));
    const rows = await this.db
      .select()
      .from(incidentTable)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(incidentTable.openedAt))
      .limit(filter.limit ?? 50);
    return rows.map(mapIncidentRow);
  }

  async updateIncident(id: string, patch: Partial<Incident>): Promise<Incident | null> {
    const row = incidentToPatch(patch);
    if (Object.keys(row).length === 0) return this.getIncident(id);
    const updated = await this.db
      .update(incidentTable)
      .set(row)
      .where(eq(incidentTable.id, id))
      .returning();
    const first = updated[0];
    return first ? mapIncidentRow(first) : null;
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

  async saveAgentStep(step: AgentStepRecord): Promise<void> {
    const values = {
      runId: step.runId,
      n: step.n,
      tool: step.tool,
      args: step.args ?? null,
      resultSummary: step.resultSummary,
      blocked: step.blocked,
      error: step.error ?? null,
      durationMs: Math.round(step.durationMs),
      tokensIn: step.tokensIn ?? null,
      tokensOut: step.tokensOut ?? null,
      createdAt: step.createdAt,
    };
    await this.db
      .insert(agentStepTable)
      .values(values)
      .onConflictDoUpdate({
        target: [agentStepTable.runId, agentStepTable.n],
        set: {
          tool: values.tool,
          args: values.args,
          resultSummary: values.resultSummary,
          blocked: values.blocked,
          error: values.error,
          durationMs: values.durationMs,
          tokensIn: values.tokensIn,
          tokensOut: values.tokensOut,
        },
      });
  }

  async listAgentSteps(filter: { runId: string; limit?: number }): Promise<AgentStepRecord[]> {
    const rows = await this.db
      .select()
      .from(agentStepTable)
      .where(eq(agentStepTable.runId, filter.runId))
      .orderBy(asc(agentStepTable.n))
      .limit(filter.limit ?? 200);
    return rows.map(mapAgentStepRow);
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

  async saveKnowledgeArticle(article: KnowledgeArticle): Promise<void> {
    const row = {
      title: article.title,
      symptoms: article.symptoms,
      steps: article.steps,
      solution: article.solution,
      category: article.category,
    };
    await this.db
      .insert(kbArticleTable)
      .values({ id: article.id, ...row, embedding: null })
      // Эмбеддинг не трогаем: поиск идёт по словам и полнотекстовому индексу.
      .onConflictDoUpdate({ target: kbArticleTable.id, set: row });
  }

  async getKnowledgeArticle(id: string): Promise<KnowledgeArticle | null> {
    const rows = await this.db
      .select()
      .from(kbArticleTable)
      .where(eq(kbArticleTable.id, id))
      .limit(1);
    const row = rows[0];
    return row ? mapKbArticleRow(row) : null;
  }

  /** Полнотекстовый поиск Postgres с русской морфологией + ILIKE как запасной путь. */
  async searchKnowledge(query: KnowledgeSearchQuery): Promise<KnowledgeArticle[]> {
    const text = query.text.trim();
    if (text === '') return [];
    const category = query.category?.trim() || null;
    const limit = normalizeLimit(query.limit);
    const pattern = `%${text}%`;
    const document = sql`to_tsvector('russian', coalesce(title, '') || ' ' || coalesce(symptoms::text, '') || ' ' || coalesce(solution, ''))`;
    const tsQuery = sql`plainto_tsquery('russian', ${text})`;

    const result = await this.db.execute<KbSearchRow>(sql`
      SELECT
        id,
        title,
        symptoms,
        steps,
        solution,
        category,
        ts_rank(${document}, ${tsQuery})
          + CASE
              WHEN title ILIKE ${pattern} THEN 0.5
              WHEN symptoms::text ILIKE ${pattern} THEN 0.3
              WHEN solution ILIKE ${pattern} THEN 0.2
              ELSE 0
            END AS score
      FROM kb_article
      WHERE (${category}::text IS NULL OR lower(category) = lower(${category}))
        AND (
          ${document} @@ ${tsQuery}
          OR title ILIKE ${pattern}
          OR symptoms::text ILIKE ${pattern}
          OR solution ILIKE ${pattern}
        )
      ORDER BY score DESC, title ASC
      LIMIT ${limit}
    `);

    return result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      symptoms: toTextArray(row.symptoms),
      steps: toTextArray(row.steps),
      solution: row.solution,
      category: row.category,
      score: toScore(row.score),
    }));
  }

  /** Похожие заявки: слова в симптомах и объекте, фильтры по категории и корпусу. */
  async findSimilarTickets(query: SimilarTicketQuery): Promise<KnowledgeSimilarTicket[]> {
    const text = query.text?.trim() ?? '';
    const category = query.category?.trim() || null;
    const building = query.building?.trim() || null;
    // Без слов и фильтров «похожие» не определены: не отдаём всю базу.
    if (text === '' && category === null && building === null) return [];
    const limit = normalizeLimit(query.limit);
    const textPattern = `%${text}%`;
    const buildingPattern = building === null ? '%' : `%${building}%`;
    const symptoms = sql`coalesce((SELECT f.value #>> '{}' FROM ticket_field f WHERE f.ticket_id = tk.id AND f.field_key = 'symptoms' LIMIT 1), '')`;
    const object = sql`coalesce((SELECT f.value #>> '{}' FROM ticket_field f WHERE f.ticket_id = tk.id AND f.field_key = 'object' LIMIT 1), '')`;
    const document = sql`to_tsvector('russian', ${symptoms} || ' ' || ${object} || ' ' || coalesce(tk.category, ''))`;
    const tsQuery = sql`plainto_tsquery('russian', ${text})`;

    const result = await this.db.execute<SimilarTicketRow>(sql`
      SELECT
        tk.id,
        tk.number,
        tk.status,
        coalesce(nullif(${symptoms}, ''), nullif(${object}, ''), 'Заявка ' || tk.number) AS title,
        ts_rank(${document}, ${tsQuery})
          + CASE
              WHEN ${symptoms} ILIKE ${textPattern} THEN 0.3
              WHEN ${object} ILIKE ${textPattern} THEN 0.2
              ELSE 0
            END AS score
      FROM ticket tk
      WHERE (${category}::text IS NULL OR lower(tk.category) = lower(${category}))
        AND (
          ${building}::text IS NULL
          OR EXISTS (
            SELECT 1 FROM ticket_field bf
            WHERE bf.ticket_id = tk.id
              AND bf.field_key = 'building'
              AND bf.value #>> '{}' ILIKE ${buildingPattern}
          )
        )
        AND (
          ${text}::text = ''
          OR ${document} @@ ${tsQuery}
          OR ${symptoms} ILIKE ${textPattern}
          OR ${object} ILIKE ${textPattern}
          OR coalesce(tk.category, '') ILIKE ${textPattern}
        )
      ORDER BY score DESC, tk.updated_at DESC
      LIMIT ${limit}
    `);

    return result.rows.map((row) => ({
      ticketId: row.id,
      number: row.number,
      status: row.status as KnowledgeSimilarTicket['status'],
      title: row.title,
      score: toScore(row.score),
    }));
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
