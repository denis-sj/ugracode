import type {
  Appeal,
  Channel,
  DomainEvent,
  FieldOrigin,
  PipelineRun,
  PriorityLevel,
  Role,
  Stage,
  StepRun,
  StepStatus,
  Ticket,
  TicketField,
  TicketStatus,
  User,
} from '@ugra/contracts';
import type {
  AppealRow,
  EventLogRow,
  PipelineRunRow,
  PipelineStepRow,
  TicketFieldRow,
  TicketRow,
  UserRow,
} from './schema';

/**
 * Приводит значение колонки-времени к ISO-строке.
 * `pg` может вернуть Date даже при `mode: 'string'`, поэтому нормализуем явно.
 */
export function toIso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') {
    // PostgreSQL отдаёт `2026-11-14 10:55:44.399+00`; приводим к ISO-виду.
    let normalized = value.trim().replace(' ', 'T');
    if (/[+-]\d{2}$/.test(normalized)) normalized += ':00';
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString();
  }
  throw new Error(`Ожидалась дата, получено: ${String(value)}`);
}

export function toIsoOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return toIso(value);
}

/** Строка БД → пользователь. */
export function mapUserRow(row: UserRow): User {
  return {
    id: row.id,
    fullName: row.fullName,
    role: row.role as Role,
    departmentId: row.departmentId,
    position: row.position,
  };
}

/** Строка БД → обращение. */
export function mapAppealRow(row: AppealRow): Appeal {
  return {
    id: row.id,
    channel: row.channel as Channel,
    authorId: row.authorId,
    originalText: row.originalText,
    attachments: row.attachments ?? [],
    createdAt: toIso(row.createdAt),
  };
}

/** Строка БД → заявка. */
export function mapTicketRow(row: TicketRow): Ticket {
  return {
    id: row.id,
    number: row.number,
    appealId: row.appealId,
    status: row.status as TicketStatus,
    priority: row.priority as PriorityLevel | null,
    category: row.category,
    departmentId: row.departmentId,
    assigneeId: row.assigneeId,
    isEmergency: row.isEmergency,
    incidentId: row.incidentId,
    slaDueAt: toIsoOrNull(row.slaDueAt),
    confirmedBy: row.confirmedBy,
    confirmedAt: toIsoOrNull(row.confirmedAt),
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

/** Строка БД → поле заявки. */
export function mapTicketFieldRow(row: TicketFieldRow): TicketField {
  return {
    ticketId: row.ticketId,
    fieldKey: row.fieldKey,
    value: row.value ?? null,
    confidence: row.confidence,
    quote: row.quote ?? null,
    origin: row.origin as FieldOrigin,
    needsReview: row.needsReview,
    trace: row.trace ?? [],
    aiValue: row.aiValue ?? null,
  };
}

/** Строка БД → запуск пайплайна. */
export function mapPipelineRunRow(row: PipelineRunRow): PipelineRun {
  return {
    id: row.id,
    ticketId: row.ticketId,
    appealId: row.appealId,
    mode: row.mode,
    status: row.status as PipelineRun['status'],
    startedAt: toIso(row.startedAt),
    finishedAt: toIsoOrNull(row.finishedAt),
  };
}

/** Строка БД → шаг пайплайна. */
export function mapPipelineStepRow(row: PipelineStepRow): StepRun {
  return {
    runId: row.runId,
    stepId: row.stepId,
    stage: row.stage as Stage,
    status: row.status as StepStatus,
    durationMs: row.durationMs,
    ticketId: row.ticketId,
    input: row.input ?? undefined,
    output: row.output ?? undefined,
    error: row.error ?? undefined,
    model: row.model,
    promptVersion: row.promptVersion,
  };
}

/** Строка БД → доменное событие. */
export function mapEventLogRow(row: EventLogRow): DomainEvent {
  return {
    id: row.id,
    type: row.type,
    at: toIso(row.at),
    actor: { kind: row.actorKind as DomainEvent['actor']['kind'], id: row.actorId ?? undefined },
    ticketId: row.ticketId ?? undefined,
    payload: row.payload,
  };
}
