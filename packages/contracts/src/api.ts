import { z } from 'zod';
import {
  Appeal,
  Channel,
  PriorityLevel,
  Role,
  StepRun,
  Ticket,
  TicketDetail,
  TicketField,
  TicketStatus,
  User,
} from './domain';
import { DictionaryItem, FieldDef } from './fields';

export const ErrorResponse = z.object({ error: z.string(), message: z.string() });
export type ErrorResponse = z.infer<typeof ErrorResponse>;

export const SessionInput = z.object({ userId: z.string().min(1) });
export type SessionInput = z.infer<typeof SessionInput>;

export const SessionResponse = z.object({ user: User });
export type SessionResponse = z.infer<typeof SessionResponse>;

export const UsersResponse = z.object({ users: z.array(User) });
export type UsersResponse = z.infer<typeof UsersResponse>;

export const CreateAppealInput = z.object({
  text: z.string().min(1),
  channel: Channel.default('chat'),
  attachments: z.array(z.string()).default([]),
});
export type CreateAppealInput = z.infer<typeof CreateAppealInput>;

export const CreateAppealResponse = z.object({
  appealId: z.string(),
  ticketId: z.string(),
  runId: z.string(),
});
export type CreateAppealResponse = z.infer<typeof CreateAppealResponse>;

export const TicketListQuery = z.object({
  status: TicketStatus.optional(),
  assigneeId: z.string().optional(),
  isEmergency: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});
export type TicketListQuery = z.infer<typeof TicketListQuery>;

export const TicketListResponse = z.object({ tickets: z.array(Ticket) });
export type TicketListResponse = z.infer<typeof TicketListResponse>;

export const TicketResponse = z.object({
  ticket: Ticket,
  appeal: Appeal,
  fields: z.array(TicketField),
  steps: z.array(StepRun),
  events: z.array(z.record(z.string(), z.unknown())).default([]),
});
export type TicketResponse = z.infer<typeof TicketResponse>;

export type { TicketDetail };

export const MetaResponse = z.object({
  modules: z.array(z.object({ id: z.string(), title: z.string() })),
  fields: z.array(FieldDef),
  dictionaries: z.array(DictionaryItem),
  aiMode: z.enum(['stub', 'cloud', 'cache-only']),
  roles: z.array(Role),
  priorities: z.array(PriorityLevel),
});
export type MetaResponse = z.infer<typeof MetaResponse>;

/** События хода разбора, которые уходят в SSE. */
export const RunStreamEvent = z.object({
  type: z.enum(['step.started', 'step.progress', 'step.completed', 'run.completed', 'run.failed']),
  runId: z.string(),
  appealId: z.string(),
  stepId: z.string().optional(),
  message: z.string().optional(),
  fields: z.array(z.string()).optional(),
  status: z.string().optional(),
});
export type RunStreamEvent = z.infer<typeof RunStreamEvent>;

export const HealthResponse = z.object({ status: z.literal('ok'), service: z.string() });
export type HealthResponse = z.infer<typeof HealthResponse>;
