import { z } from 'zod';
import { FieldValue } from './fields';

export const Role = z.enum(['applicant', 'dispatcher', 'engineer', 'manager', 'admin']);
export type Role = z.infer<typeof Role>;

export const Channel = z.enum(['chat', 'phone', 'screenshot', 'email']);
export type Channel = z.infer<typeof Channel>;

export const Stage = z.enum([
  'intake',
  'enrich',
  'extract',
  'validate',
  'assess',
  'route',
  'knowledge',
  'respond',
  'finalize',
]);
export type Stage = z.infer<typeof Stage>;

/** Порядок стадий пайплайна. Внутри стадии шаги сортируются по `order`. */
export const STAGES: readonly Stage[] = Stage.options;

export const TicketStatus = z.enum([
  'new',
  'ai_draft',
  'waiting_applicant',
  'in_review',
  'assigned',
  'in_progress',
  'resolved',
  'closed',
  'cancelled',
]);
export type TicketStatus = z.infer<typeof TicketStatus>;

export const PriorityLevel = z.enum(['critical', 'high', 'medium', 'low']);
export type PriorityLevel = z.infer<typeof PriorityLevel>;

export type Permission =
  | 'any'
  | 'appeal.create'
  | 'appeal.readOwn'
  | 'appeal.answer'
  | 'tickets.queue'
  | 'tickets.read'
  | 'tickets.edit'
  | 'tickets.confirm'
  | 'tickets.transition'
  | 'tickets.events'
  | 'reports'
  | 'settings'
  | 'admin';

/** Права по ролям (раздел 4.2 спецификации). */
export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  applicant: ['any', 'appeal.create', 'appeal.readOwn', 'appeal.answer', 'tickets.read'],
  dispatcher: [
    'any',
    'appeal.create',
    'appeal.readOwn',
    'appeal.answer',
    'tickets.queue',
    'tickets.read',
    'tickets.edit',
    'tickets.confirm',
    'tickets.transition',
    'tickets.events',
  ],
  engineer: [
    'any',
    'appeal.create',
    'appeal.readOwn',
    'appeal.answer',
    'tickets.read',
    'tickets.transition',
  ],
  manager: ['any', 'appeal.create', 'appeal.readOwn', 'appeal.answer', 'tickets.read', 'tickets.events', 'reports', 'settings'],
  admin: [
    'any',
    'appeal.create',
    'appeal.readOwn',
    'appeal.answer',
    'tickets.queue',
    'tickets.read',
    'tickets.edit',
    'tickets.confirm',
    'tickets.transition',
    'tickets.events',
    'reports',
    'settings',
    'admin',
  ],
};

export function hasPermission(role: Role, permission: Permission): boolean {
  return permission === 'any' || ROLE_PERMISSIONS[role].includes(permission);
}

export interface StatusTransition {
  from: TicketStatus;
  to: TicketStatus;
  roles: readonly Role[];
  permission: Permission;
}

/** Таблица переходов статусов (раздел 4.1). Смена статуса — только через `tickets.transition()`. */
export const TRANSITIONS: readonly StatusTransition[] = [
  { from: 'new', to: 'ai_draft', roles: ['admin'], permission: 'tickets.transition' },
  { from: 'ai_draft', to: 'waiting_applicant', roles: ['admin'], permission: 'tickets.transition' },
  { from: 'waiting_applicant', to: 'ai_draft', roles: ['applicant', 'admin'], permission: 'tickets.transition' },
  { from: 'ai_draft', to: 'in_review', roles: ['admin'], permission: 'tickets.transition' },
  { from: 'waiting_applicant', to: 'in_review', roles: ['dispatcher', 'admin'], permission: 'tickets.transition' },
  { from: 'in_review', to: 'assigned', roles: ['dispatcher', 'admin'], permission: 'tickets.confirm' },
  { from: 'in_review', to: 'cancelled', roles: ['dispatcher', 'admin'], permission: 'tickets.transition' },
  { from: 'assigned', to: 'in_progress', roles: ['engineer', 'admin'], permission: 'tickets.transition' },
  { from: 'in_progress', to: 'resolved', roles: ['engineer', 'admin'], permission: 'tickets.transition' },
  { from: 'resolved', to: 'closed', roles: ['applicant', 'admin'], permission: 'tickets.transition' },
  { from: 'resolved', to: 'in_progress', roles: ['applicant', 'admin'], permission: 'tickets.transition' },
];

export function findTransition(from: TicketStatus, to: TicketStatus): StatusTransition | undefined {
  return TRANSITIONS.find((t) => t.from === from && t.to === to);
}

export const User = z.object({
  id: z.string(),
  fullName: z.string(),
  role: Role,
  departmentId: z.string().nullable(),
  position: z.string(),
});
export type User = z.infer<typeof User>;

export const Appeal = z.object({
  id: z.string(),
  channel: Channel,
  authorId: z.string(),
  originalText: z.string(),
  attachments: z.array(z.string()).default([]),
  createdAt: z.string(),
});
export type Appeal = z.infer<typeof Appeal>;

export const SourceFragment = z.object({
  id: z.string(),
  kind: z.enum(['text', 'transcript', 'image', 'attachment']),
  text: z.string(),
  label: z.string().optional(),
});
export type SourceFragment = z.infer<typeof SourceFragment>;

export const MissingField = z.object({
  key: z.string(),
  label: z.string(),
  question: z.string(),
  widget: z.enum(['buttons', 'select', 'text', 'location']),
  options: z.array(z.object({ value: z.string(), label: z.string() })).optional(),
});
export type MissingField = z.infer<typeof MissingField>;

export const EmergencySign = z.object({ sign: z.string(), quote: z.string() });
export type EmergencySign = z.infer<typeof EmergencySign>;

export const EmergencyVerdict = z.object({
  level: z.enum(['none', 'suspected', 'confirmed']),
  signs: z.array(EmergencySign).default([]),
  confidence: z.number().min(0).max(1),
  rulesMatched: z.array(z.string()).default([]),
  checklist: z.array(z.string()).default([]),
  notifyUserIds: z.array(z.string()).default([]),
});
export type EmergencyVerdict = z.infer<typeof EmergencyVerdict>;

export const IncidentLink = z.object({
  incidentId: z.string(),
  size: z.number().int().nonnegative(),
  reason: z.string(),
});
export type IncidentLink = z.infer<typeof IncidentLink>;

export const PriorityVerdict = z.object({
  value: PriorityLevel,
  slaDueAt: z.string(),
  rule: z.string(),
  reasons: z.array(z.string()).default([]),
});
export type PriorityVerdict = z.infer<typeof PriorityVerdict>;

export const AssigneeCandidate = z.object({
  userId: z.string(),
  score: z.number(),
  reasons: z.array(z.string()).default([]),
});
export type AssigneeCandidate = z.infer<typeof AssigneeCandidate>;

export const KnowledgeHit = z.object({
  kind: z.enum(['article', 'ticket']),
  id: z.string(),
  title: z.string(),
  score: z.number(),
});
export type KnowledgeHit = z.infer<typeof KnowledgeHit>;

export const ReplyDraft = z.object({
  text: z.string(),
  template: z.boolean().default(false),
});
export type ReplyDraft = z.infer<typeof ReplyDraft>;

export const AnalysisDraft = z.object({
  sources: z.array(SourceFragment),
  fields: z.record(z.string(), FieldValue),
  missing: z.array(MissingField).default([]),
  emergency: EmergencyVerdict.optional(),
  incident: IncidentLink.optional(),
  priority: PriorityVerdict.optional(),
  assignees: z.array(AssigneeCandidate).optional(),
  knowledge: z.array(KnowledgeHit).optional(),
  replyDraft: ReplyDraft.optional(),
  /** Данные модулей: ключ = id модуля, схема живёт в модуле. */
  ext: z.record(z.string(), z.unknown()).default({}),
});
export type AnalysisDraft = z.infer<typeof AnalysisDraft>;
export type DraftKey = keyof AnalysisDraft;

export const StepStatus = z.enum(['ok', 'fallback', 'failed', 'timeout']);
export type StepStatus = z.infer<typeof StepStatus>;

export const StepRun = z.object({
  runId: z.string(),
  stepId: z.string(),
  stage: Stage,
  status: StepStatus,
  durationMs: z.number().nonnegative(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  error: z.string().optional(),
  model: z.string().nullable().optional(),
  promptVersion: z.string().nullable().optional(),
});
export type StepRun = z.infer<typeof StepRun>;

export const PipelineRun = z.object({
  id: z.string(),
  ticketId: z.string().nullable(),
  appealId: z.string(),
  mode: z.string(),
  status: z.enum(['running', 'ok', 'failed']),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type PipelineRun = z.infer<typeof PipelineRun>;

export const StepResult = z.object({
  stepId: z.string(),
  stage: Stage,
  status: StepStatus,
  durationMs: z.number().nonnegative(),
  error: z.string().optional(),
});
export type StepResult = z.infer<typeof StepResult>;

export const Metric = z.object({
  key: z.string(),
  value: z.number(),
  expected: z.union([z.number(), z.string()]).optional(),
  passed: z.boolean().optional(),
});
export type Metric = z.infer<typeof Metric>;

export const ExpectedCase = z.object({
  fields: z.record(z.string(), z.string().nullable()),
  priority: PriorityLevel.optional(),
  emergency: z.boolean().optional(),
  assigneeTop3: z.array(z.string()).optional(),
  kbArticle: z.string().optional(),
});
export type ExpectedCase = z.infer<typeof ExpectedCase>;

export const Ticket = z.object({
  id: z.string(),
  number: z.string(),
  appealId: z.string(),
  status: TicketStatus,
  priority: PriorityLevel.nullable(),
  category: z.string().nullable(),
  departmentId: z.string().nullable(),
  assigneeId: z.string().nullable(),
  isEmergency: z.boolean(),
  incidentId: z.string().nullable(),
  slaDueAt: z.string().nullable(),
  confirmedBy: z.string().nullable(),
  confirmedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Ticket = z.infer<typeof Ticket>;

export const TicketField = z.object({
  ticketId: z.string(),
  fieldKey: z.string(),
  value: z.union([z.string(), z.number()]).nullable(),
  confidence: z.number(),
  quote: z.object({ sourceId: z.string(), text: z.string() }).nullable(),
  origin: z.enum(['text', 'asked', 'cmdb', 'rule', 'human', 'none']),
  needsReview: z.boolean(),
  trace: z.array(z.unknown()).default([]),
  aiValue: z.union([z.string(), z.number()]).nullable(),
});
export type TicketField = z.infer<typeof TicketField>;

export const TicketDetail = z.object({
  ticket: Ticket,
  appeal: Appeal,
  fields: z.array(TicketField),
  steps: z.array(StepRun),
  events: z.array(z.unknown()).optional(),
});
export type TicketDetail = z.infer<typeof TicketDetail>;
