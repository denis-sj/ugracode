import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
  vector,
} from 'drizzle-orm/pg-core';

const tstz = (name: string) => timestamp(name, { withTimezone: true, mode: 'string' });

/** Пользователи системы. Роли: applicant, dispatcher, engineer, manager, admin. */
export const userTable = pgTable('user', {
  id: text('id').primaryKey(),
  fullName: text('full_name').notNull(),
  role: text('role').notNull(),
  departmentId: text('department_id'),
  position: text('position').notNull(),
});

/** Оригинал обращения. Не меняется после создания. */
export const appealTable = pgTable('appeal', {
  id: text('id').primaryKey(),
  channel: text('channel').notNull(),
  authorId: text('author_id').notNull(),
  originalText: text('original_text').notNull(),
  attachments: jsonb('attachments').$type<string[]>().notNull().default([]),
  createdAt: tstz('created_at').notNull(),
});

/** Чат заявителя с системой: вопросы-карточки, ответы, системные сообщения. */
export const appealMessageTable = pgTable('appeal_message', {
  id: text('id').primaryKey(),
  appealId: text('appeal_id').notNull(),
  direction: text('direction').notNull(),
  kind: text('kind').notNull(),
  body: text('body').notNull(),
  fieldKey: text('field_key'),
  createdAt: tstz('created_at').notNull().defaultNow(),
});

/**
 * Заявка. Колонки priority…confirmed_at — копия полей для быстрых отчётов.
 */
export const ticketTable = pgTable(
  'ticket',
  {
    id: text('id').primaryKey(),
    number: text('number').notNull(),
    appealId: text('appeal_id').notNull(),
    status: text('status').notNull(),
    priority: text('priority'),
    category: text('category'),
    departmentId: text('department_id'),
    assigneeId: text('assignee_id'),
    isEmergency: boolean('is_emergency').notNull().default(false),
    incidentId: text('incident_id'),
    slaDueAt: tstz('sla_due_at'),
    confirmedBy: text('confirmed_by'),
    confirmedAt: tstz('confirmed_at'),
    createdAt: tstz('created_at').notNull(),
    updatedAt: tstz('updated_at').notNull(),
  },
  (table) => [index('ticket_status_idx').on(table.status)],
);

/** Одна строка на поле заявки; `ai_value` хранит, что предложил ИИ. */
export const ticketFieldTable = pgTable(
  'ticket_field',
  {
    ticketId: text('ticket_id').notNull(),
    fieldKey: text('field_key').notNull(),
    value: jsonb('value').$type<string | number | null>(),
    confidence: numeric('confidence', { precision: 4, scale: 3, mode: 'number' }).notNull(),
    quote: jsonb('quote').$type<{ sourceId: string; text: string } | null>(),
    origin: text('origin').notNull(),
    needsReview: boolean('needs_review').notNull().default(false),
    trace: jsonb('trace').$type<unknown[]>().notNull().default([]),
    aiValue: jsonb('ai_value').$type<string | number | null>(),
  },
  (table) => [
    primaryKey({ columns: [table.ticketId, table.fieldKey] }),
    index('ticket_field_ticket_id_idx').on(table.ticketId),
  ],
);

/** След разбора: один запуск пайплайна. */
export const pipelineRunTable = pgTable('pipeline_run', {
  id: text('id').primaryKey(),
  ticketId: text('ticket_id'),
  appealId: text('appeal_id').notNull(),
  mode: text('mode').notNull(),
  status: text('status').notNull(),
  startedAt: tstz('started_at').notNull(),
  finishedAt: tstz('finished_at'),
});

/** След разбора: шаг внутри запуска. */
export const pipelineStepTable = pgTable(
  'pipeline_step',
  {
    runId: text('run_id').notNull(),
    stepId: text('step_id').notNull(),
    stage: text('stage').notNull(),
    status: text('status').notNull(),
    durationMs: integer('duration_ms').notNull(),
    ticketId: text('ticket_id'),
    input: jsonb('input'),
    output: jsonb('output'),
    error: text('error'),
    model: text('model'),
    promptVersion: text('prompt_version'),
    createdAt: tstz('created_at').notNull().defaultNow(),
  },
  (table) => [index('pipeline_step_run_id_idx').on(table.runId)],
);

/** Журнал действий. Только добавление — в БД висит триггер. */
export const eventLogTable = pgTable(
  'event_log',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    at: tstz('at').notNull(),
    actorKind: text('actor_kind').notNull(),
    actorId: text('actor_id'),
    ticketId: text('ticket_id'),
    payload: jsonb('payload'),
  },
  (table) => [index('event_log_ticket_at_idx').on(table.ticketId, table.at)],
);

/** Справочники: здания, категории, важность, срочность, каналы. */
export const dictionaryItemTable = pgTable(
  'dictionary_item',
  {
    dictionary: text('dictionary').notNull(),
    code: text('code').notNull(),
    label: text('label').notNull(),
    parentCode: text('parent_code'),
    meta: jsonb('meta').$type<Record<string, unknown> | null>(),
  },
  (table) => [primaryKey({ columns: [table.dictionary, table.code] })],
);

/** Реестр полей: полное определение поля в jsonb. */
export const fieldDefTable = pgTable('field_def', {
  key: text('key').primaryKey(),
  def: jsonb('def').$type<Record<string, unknown>>().notNull(),
  moduleId: text('module_id'),
});

/** Настройки: пороги уверенности, окно массовости и т.п. */
export const settingTable = pgTable('setting', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedBy: text('updated_by'),
  updatedAt: tstz('updated_at').notNull().defaultNow(),
});

/** CMDB: корпус → этаж → кабинет. */
export const cmdbLocationTable = pgTable('cmdb_location', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull(),
  name: text('name').notNull(),
  parentId: text('parent_id'),
});

/** CMDB: оборудование. */
export const cmdbEquipmentTable = pgTable('cmdb_equipment', {
  id: text('id').primaryKey(),
  type: text('type').notNull(),
  model: text('model').notNull(),
  serial: text('serial'),
  inventoryNo: text('inventory_no'),
  ip: text('ip'),
  building: text('building'),
  cabinet: text('cabinet'),
  criticality: text('criticality').notNull(),
});

/** Профиль инженера для маршрутизации. */
export const engineerProfileTable = pgTable('engineer_profile', {
  userId: text('user_id').primaryKey(),
  department: text('department').notNull(),
  level: text('level').notNull(),
  buildings: jsonb('buildings').$type<string[]>().notNull().default([]),
  onDuty: boolean('on_duty').notNull().default(false),
  status: text('status').notNull().default('available'),
});

/** Навык инженера и уровень владения. */
export const engineerSkillTable = pgTable(
  'engineer_skill',
  {
    userId: text('user_id').notNull(),
    skill: text('skill').notNull(),
    level: integer('level').notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.skill] })],
);

/** Смены и дежурства инженеров. */
export const dutyShiftTable = pgTable('duty_shift', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: text('user_id').notNull(),
  kind: text('kind').notNull(),
  startsAt: tstz('starts_at').notNull(),
  endsAt: tstz('ends_at').notNull(),
});

/** База знаний: статьи с эмбеддингом симптомов. */
export const kbArticleTable = pgTable('kb_article', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  symptoms: jsonb('symptoms').$type<string[]>().notNull().default([]),
  steps: jsonb('steps').$type<string[]>().notNull().default([]),
  solution: text('solution').notNull(),
  category: text('category'),
  embedding: vector('embedding', { dimensions: 768 }),
});

/** Уведомления пользователям. */
export const notificationTable = pgTable('notification', {
  id: text('id').primaryKey(),
  toUserId: text('to_user_id').notNull(),
  channel: text('channel').notNull(),
  title: text('title').notNull(),
  body: text('body').notNull(),
  ticketId: text('ticket_id'),
  readAt: tstz('read_at'),
  createdAt: tstz('created_at').notNull().defaultNow(),
});

/** Кэш ответов моделей (порт + ключ запроса). */
export const aiCacheTable = pgTable('ai_cache', {
  key: text('key').primaryKey(),
  port: text('port').notNull(),
  response: jsonb('response').notNull(),
  createdAt: tstz('created_at').notNull().defaultNow(),
});

export const schema = {
  userTable,
  appealTable,
  appealMessageTable,
  ticketTable,
  ticketFieldTable,
  pipelineRunTable,
  pipelineStepTable,
  eventLogTable,
  dictionaryItemTable,
  fieldDefTable,
  settingTable,
  cmdbLocationTable,
  cmdbEquipmentTable,
  engineerProfileTable,
  engineerSkillTable,
  dutyShiftTable,
  kbArticleTable,
  notificationTable,
  aiCacheTable,
};

export type UserRow = typeof userTable.$inferSelect;
export type AppealRow = typeof appealTable.$inferSelect;
export type TicketRow = typeof ticketTable.$inferSelect;
export type TicketFieldRow = typeof ticketFieldTable.$inferSelect;
export type PipelineRunRow = typeof pipelineRunTable.$inferSelect;
export type PipelineStepRow = typeof pipelineStepTable.$inferSelect;
export type EventLogRow = typeof eventLogTable.$inferSelect;
